package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-webdav/carddav"
)

type davETagTestTransport struct {
	response *http.Response
}

func (t davETagTestTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return t.response, nil
}

type davETagTestBody struct {
	reader   io.Reader
	closeErr error
	closed   bool
}

func (b *davETagTestBody) Read(data []byte) (int, error) {
	return b.reader.Read(data)
}

func (b *davETagTestBody) Close() error {
	b.closed = true
	return b.closeErr
}

type davETagReadError struct {
	err error
}

func (r davETagReadError) Read([]byte) (int, error) {
	return 0, r.err
}

func TestDefaultCardDAVClientFactory_QueryAddressBookAcceptsMailboxOrgUnquotedETag(t *testing.T) {
	// Given a mailbox.org-style CardDAV server response with an unquoted DAV:getetag.
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if request.Method != "REPORT" {
			t.Errorf("expected REPORT request, got %s", request.Method)
		}
		if request.URL.Path != "/addressbooks/user/default/" {
			t.Errorf("expected address book path, got %q", request.URL.Path)
		}
		username, password, authenticated := request.BasicAuth()
		if !authenticated || username != "mailbox-user" || password != "mailbox-password" {
			t.Errorf("expected deterministic basic authentication, got username=%q authenticated=%t", username, authenticated)
		}
		if request.Header.Get("Depth") != "1" {
			t.Errorf("expected Depth: 1, got %q", request.Header.Get("Depth"))
		}

		requestBody, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("read REPORT body: %v", err)
			return
		}
		for _, expectedElement := range []string{"addressbook-query", "address-data", "allprop", "getetag"} {
			if !strings.Contains(string(requestBody), expectedElement) {
				t.Errorf("expected REPORT body to contain %q: %s", expectedElement, requestBody)
			}
		}

		responseWriter.Header().Set("Content-Type", "application/xml; charset=utf-8")
		responseWriter.WriteHeader(http.StatusMultiStatus)
		_, err = io.WriteString(responseWriter, `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/addressbooks/user/default/alice.vcf</D:href>
    <D:propstat>
      <D:prop>
        <C:address-data>BEGIN:VCARD
VERSION:3.0
FN:Alice Example
N:Example;Alice;;;
UID:alice-example
END:VCARD
</C:address-data>
        <D:getetag>mailbox-org-etag-123</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`)
		if err != nil {
			t.Errorf("write multistatus response: %v", err)
		}
	}))
	defer server.Close()

	client, err := (&DefaultCardDAVClientFactory{}).NewClient(server.URL, "mailbox-user", "mailbox-password")
	if err != nil {
		t.Fatalf("create production CardDAV client: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// When the production client queries the remote address book.
	objects, err := client.QueryAddressBook(ctx, "/addressbooks/user/default/", &carddav.AddressBookQuery{
		DataRequest: carddav.AddressDataRequest{AllProp: true},
	})

	// Then the valid vCard is parsed and the server ETag is preserved without quotes.
	if err != nil {
		t.Fatalf("query address book with mailbox.org unquoted ETag: %v", err)
	}
	if len(objects) != 1 {
		t.Fatalf("expected one address object, got %d", len(objects))
	}
	if objects[0].Path != "/addressbooks/user/default/alice.vcf" {
		t.Errorf("expected address object path to be preserved, got %q", objects[0].Path)
	}
	if objects[0].ETag != "mailbox-org-etag-123" {
		t.Errorf("expected unquoted ETag to be preserved, got %q", objects[0].ETag)
	}
	if objects[0].Card == nil || objects[0].Card.Value("FN") != "Alice Example" {
		t.Errorf("expected valid vCard to be parsed, got %#v", objects[0].Card)
	}
}

func TestDAVETagCompatibilityTransport_NormalizesOnlyBareDAVETagText(t *testing.T) {
	tests := []struct{ name, contentType, body, wantBody string }{
		{
			name:        "quotes bare DAV ETag",
			contentType: "application/xml; charset=utf-8",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag>mailbox-org-etag-123</D:getetag></D:multistatus>`,
			wantBody:    `<D:multistatus xmlns:D="DAV:"><D:getetag>"mailbox-org-etag-123"</D:getetag></D:multistatus>`,
		},
		{
			name:        "leaves literal quoted ETag unchanged",
			contentType: "application/xml",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag>"already-quoted"</D:getetag></D:multistatus>`,
		},
		{
			name:        "leaves XML entity quoted ETag unchanged",
			contentType: "application/xml",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag>&quot;entity-quoted&quot;</D:getetag></D:multistatus>`,
		},
		{
			name:        "leaves nested DAV ETag content unchanged",
			contentType: "application/xml",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag>prefix<D:opaque>nested</D:opaque>suffix</D:getetag></D:multistatus>`,
		},
		{
			name:        "leaves empty ETag unchanged",
			contentType: "application/xml",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag/></D:multistatus>`,
		},
		{
			name:        "leaves weak ETag unchanged",
			contentType: "application/xml",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag>W/"weak"</D:getetag></D:multistatus>`,
		},
		{
			name:        "leaves malformed ETag unchanged",
			contentType: "application/xml",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag>W/unquoted</D:getetag></D:multistatus>`,
		},
		{
			name:        "leaves escaped malformed ETag unchanged",
			contentType: "application/xml",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag>malformed\escape</D:getetag></D:multistatus>`,
		},
		{
			name:        "leaves malformed XML unchanged",
			contentType: "application/xml",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag>unclosed</D:getetag>`,
		},
		{
			name:        "leaves non DAV getetag unchanged",
			contentType: "application/xml",
			body:        `<X:multistatus xmlns:X="urn:example"><X:getetag>not-a-dav-etag</X:getetag></X:multistatus>`,
		},
		{
			name:        "leaves non XML response unchanged",
			contentType: "text/plain",
			body:        `<D:multistatus xmlns:D="DAV:"><D:getetag>not-xml-content</D:getetag></D:multistatus>`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			wantBody := test.wantBody
			if wantBody == "" {
				wantBody = test.body
			}
			response := &http.Response{Body: io.NopCloser(strings.NewReader(test.body)), ContentLength: int64(len(test.body)), Header: http.Header{"Content-Type": {test.contentType}, "Content-Length": {fmt.Sprintf("%d", len(test.body))}}}
			client := &http.Client{Transport: &davETagCompatibilityTransport{base: davETagTestTransport{response: response}}}

			result, err := client.Get("https://dav.example.test")
			if err != nil {
				t.Fatalf("perform request: %v", err)
			}
			defer result.Body.Close()
			body, err := io.ReadAll(result.Body)
			if err != nil {
				t.Fatalf("read normalized response: %v", err)
			}

			if string(body) != wantBody {
				t.Errorf("expected body %q, got %q", wantBody, body)
			}
			if result.ContentLength != int64(len(wantBody)) {
				t.Errorf("expected ContentLength %d, got %d", len(wantBody), result.ContentLength)
			}
			if result.Header.Get("Content-Length") != fmt.Sprintf("%d", len(wantBody)) {
				t.Errorf("expected Content-Length %d, got %q", len(wantBody), result.Header.Get("Content-Length"))
			}
		})
	}
}

func TestDAVETagCompatibilityTransport_ResponseBodySemantics(t *testing.T) {
	readErr, closeErr := errors.New("body read failed"), errors.New("body close failed")
	tests := []struct {
		name              string
		reader            io.Reader
		closeErr, wantErr error
		wantResponse      bool
	}{
		{
			name:         "closes original body after normalization",
			reader:       strings.NewReader(`<D:multistatus xmlns:D="DAV:"><D:getetag>bare</D:getetag></D:multistatus>`),
			wantResponse: true,
		},
		{
			name:    "propagates read error after closing original body",
			reader:  davETagReadError{err: readErr},
			wantErr: readErr,
		},
		{
			name:     "propagates close error",
			reader:   strings.NewReader(`<D:multistatus xmlns:D="DAV:"><D:getetag>bare</D:getetag></D:multistatus>`),
			closeErr: closeErr,
			wantErr:  closeErr,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			// Given an XML response body with a controlled read or close outcome.
			body := &davETagTestBody{reader: test.reader, closeErr: test.closeErr}
			response := &http.Response{Body: body, Header: http.Header{"Content-Type": {"application/xml"}}}
			transport := &davETagCompatibilityTransport{base: davETagTestTransport{response: response}}

			// When the compatibility transport processes the response.
			result, err := transport.RoundTrip(httptest.NewRequest(http.MethodGet, "https://dav.example.test", nil))

			// Then it closes the original body and exposes the corresponding result.
			if test.wantErr == nil && err != nil {
				t.Errorf("round trip: %v", err)
			}
			if test.wantErr != nil && !errors.Is(err, test.wantErr) {
				t.Errorf("expected error %v, got %v", test.wantErr, err)
			}
			if (result != nil) != test.wantResponse {
				t.Errorf("expected response present=%t, got %#v", test.wantResponse, result)
			}
			if result != nil {
				defer result.Body.Close()
			}
			if !body.closed {
				t.Error("expected original response body to be closed")
			}
		})
	}
}

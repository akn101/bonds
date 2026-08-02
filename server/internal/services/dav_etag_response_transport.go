package services

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"unicode"
)

type davETagCompatibilityTransport struct {
	base http.RoundTripper
}

func (t *davETagCompatibilityTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	transport := t.base
	if transport == nil {
		transport = http.DefaultTransport
	}

	response, err := transport.RoundTrip(request)
	if err != nil || response == nil || response.Body == nil || !isXMLContentType(response.Header.Get("Content-Type")) {
		return response, err
	}

	body, readErr := io.ReadAll(response.Body)
	closeErr := response.Body.Close()
	if readErr != nil {
		return nil, fmt.Errorf("read DAV XML response body: %w", readErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("close DAV XML response body: %w", closeErr)
	}

	normalizedBody := normalizeDAVETags(body)
	response.Body = io.NopCloser(bytes.NewReader(normalizedBody))
	if !bytes.Equal(body, normalizedBody) {
		response.ContentLength = int64(len(normalizedBody))
		response.Header.Set("Content-Length", fmt.Sprintf("%d", len(normalizedBody)))
	}

	return response, nil
}

func isXMLContentType(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}
	return mediaType == "application/xml" || mediaType == "text/xml" || strings.HasSuffix(mediaType, "+xml")
}

func normalizeDAVETags(body []byte) []byte {
	decoder := xml.NewDecoder(bytes.NewReader(body))
	var replacements []davETagTextReplacement
	var element *davETagElement

	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return body
		}

		switch token := token.(type) {
		case xml.StartElement:
			if element == nil && token.Name.Space == "DAV:" && token.Name.Local == "getetag" {
				element = &davETagElement{contentStart: decoder.InputOffset()}
			} else if element != nil {
				element.hasNestedContent = true
			}
		case xml.CharData:
			if element != nil {
				element.text.Write([]byte(token))
			}
		case xml.EndElement:
			if element != nil && token.Name.Space == "DAV:" && token.Name.Local == "getetag" {
				contentEnd := bytes.LastIndex(body[:decoder.InputOffset()], []byte("</"))
				text := element.text.String()
				if int64(contentEnd) >= element.contentStart && !element.hasNestedContent {
					rawText := body[element.contentStart:int64(contentEnd)]
					if string(rawText) == text && isBareDAVETag(text) {
						// Some DAV servers omit ETag quotes, but go-webdav passes this exact text to strconv.Unquote.
						replacements = append(replacements, davETagTextReplacement{
							start: element.contentStart,
							end:   int64(contentEnd),
							value: []byte(`"` + string(rawText) + `"`),
						})
					}
				}
				element = nil
			}
		}
	}

	if len(replacements) == 0 {
		return body
	}

	var normalized bytes.Buffer
	lastEnd := int64(0)
	for _, replacement := range replacements {
		normalized.Write(body[lastEnd:replacement.start])
		normalized.Write(replacement.value)
		lastEnd = replacement.end
	}
	normalized.Write(body[lastEnd:])
	return normalized.Bytes()
}

type davETagElement struct {
	contentStart     int64
	text             strings.Builder
	hasNestedContent bool
}

type davETagTextReplacement struct {
	start int64
	end   int64
	value []byte
}

func isBareDAVETag(value string) bool {
	return value != "" && !strings.HasPrefix(value, "W/") && !strings.ContainsRune(value, '"') && !strings.ContainsRune(value, '\\') && !strings.ContainsFunc(value, unicode.IsSpace)
}

var _ http.RoundTripper = (*davETagCompatibilityTransport)(nil)

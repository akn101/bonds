import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContactAvatar from "@/components/ContactAvatar";
import { httpClient } from "@/api";
import {
  createDeferred,
  expectFallback,
  installObjectUrlProbe,
  type AvatarResponse,
} from "@/test/contactAvatarTestSupport";

vi.mock("@/api", () => ({
  httpClient: {
    instance: {
      get: vi.fn(),
    },
  },
}));

describe("ContactAvatar request races", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores an old response that resolves after the new contact response", async () => {
    // Given
    const oldRequest = createDeferred<AvatarResponse>();
    const newRequest = createDeferred<AvatarResponse>();
    const probe = installObjectUrlProbe(["blob:grace"]);
    vi.mocked(httpClient.instance.get)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const view = render(
      <ContactAvatar
        vaultId="vault-1"
        contactId="ada"
        firstName="Ada"
        lastName="Lovelace"
      />,
    );
    view.rerender(
      <ContactAvatar
        vaultId="vault-1"
        contactId="grace"
        firstName="Grace"
        lastName="Hopper"
      />,
    );

    // When
    await act(async () => {
      newRequest.resolve({ data: new Blob(["grace"]) });
      await newRequest.promise;
    });
    await act(async () => {
      oldRequest.resolve({ data: new Blob(["ada"]) });
      await oldRequest.promise;
    });

    // Then
    expect(screen.getByRole("img", { name: "GH" })).toHaveAttribute(
      "src",
      "blob:grace",
    );
    expect(probe.createObjectURL).toHaveBeenCalledOnce();
    expect(probe.revokeObjectURL).not.toHaveBeenCalled();
    expect(probe.revokedWhileRendered).toEqual([]);
  });

  it("replaces a versioned avatar and revokes each URL exactly once", async () => {
    // Given
    const replacement = createDeferred<AvatarResponse>();
    const probe = installObjectUrlProbe(["blob:version-1", "blob:version-2"]);
    vi.mocked(httpClient.instance.get)
      .mockResolvedValueOnce({ data: new Blob(["first"]) })
      .mockReturnValueOnce(replacement.promise);
    const view = render(
      <ContactAvatar
        vaultId="vault-1"
        contactId="contact-1"
        firstName="Ada"
        lastName="Lovelace"
        updatedAt="version-1"
      />,
    );
    expect(await screen.findByRole("img", { name: "AL" })).toHaveAttribute(
      "src",
      "blob:version-1",
    );

    // When
    view.rerender(
      <ContactAvatar
        vaultId="vault-1"
        contactId="contact-1"
        firstName="Ada"
        lastName="Lovelace"
        updatedAt="version-2"
      />,
    );
    expectFallback("AL", probe);
    await act(async () => {
      replacement.resolve({ data: new Blob(["second"]) });
      await replacement.promise;
    });

    // Then
    expect(screen.getByRole("img", { name: "AL" })).toHaveAttribute(
      "src",
      "blob:version-2",
    );
    expect(httpClient.instance.get).toHaveBeenNthCalledWith(
      2,
      "/vaults/vault-1/contacts/contact-1/avatar",
      { responseType: "blob", params: { t: "version-2" } },
    );
    view.unmount();
    expect(probe.revokedWhileRendered).toEqual([]);
    expect(probe.revokeObjectURL.mock.calls).toEqual([
      ["blob:version-1"],
      ["blob:version-2"],
    ]);
  });
});

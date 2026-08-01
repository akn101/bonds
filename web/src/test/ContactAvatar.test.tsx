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

describe("ContactAvatar object URL ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retires the old URL before a deferred avatar version switch resolves", async () => {
    // Given
    const pendingReplacement = createDeferred<AvatarResponse>();
    const probe = installObjectUrlProbe(["blob:ada"]);
    vi.mocked(httpClient.instance.get)
      .mockResolvedValueOnce({ data: new Blob(["ada"]) })
      .mockReturnValueOnce(pendingReplacement.promise);
    const view = render(
      <ContactAvatar
        vaultId="vault-1"
        contactId="contact-1"
        firstName="Ada"
        lastName="Lovelace"
      />,
    );
    expect(await screen.findByRole("img", { name: "AL" })).toHaveAttribute(
      "src",
      "blob:ada",
    );

    // When
    view.rerender(
      <ContactAvatar
        vaultId="vault-1"
        contactId="contact-1"
        firstName="Ada"
        lastName="Lovelace"
        updatedAt=""
      />,
    );

    // Then
    expectFallback("AL", probe);
    expect(probe.revokeObjectURL).toHaveBeenCalledOnce();
    expect(probe.revokeObjectURL).toHaveBeenCalledWith("blob:ada");
  });

  it("keeps initials after the replacement request rejects", async () => {
    // Given
    const replacement = createDeferred<AvatarResponse>();
    const probe = installObjectUrlProbe(["blob:version-1"]);
    vi.mocked(httpClient.instance.get)
      .mockResolvedValueOnce({ data: new Blob(["avatar"]) })
      .mockReturnValueOnce(replacement.promise);
    const view = render(
      <ContactAvatar
        vaultId="vault-1"
        contactId="contact-1"
        firstName="Ada"
        lastName="Lovelace"
      />,
    );
    expect(await screen.findByRole("img", { name: "AL" })).toBeInTheDocument();

    // When
    view.rerender(
      <ContactAvatar
        vaultId="vault-1"
        contactId="contact-1"
        firstName="Ada"
        lastName="Lovelace"
        updatedAt=""
      />,
    );
    await act(async () => {
      replacement.reject(new Error("avatar unavailable"));
      await expect(replacement.promise).rejects.toThrow("avatar unavailable");
    });

    // Then
    expectFallback("AL", probe);
    expect(probe.revokeObjectURL.mock.calls).toEqual([["blob:version-1"]]);
  });

  it("keeps initials when the replacement response contains an empty Blob", async () => {
    // Given
    const replacement = createDeferred<AvatarResponse>();
    const probe = installObjectUrlProbe(["blob:version-1"]);
    vi.mocked(httpClient.instance.get)
      .mockResolvedValueOnce({ data: new Blob(["avatar"]) })
      .mockReturnValueOnce(replacement.promise);
    const view = render(
      <ContactAvatar
        vaultId="vault-1"
        contactId="contact-1"
        firstName="Ada"
        lastName="Lovelace"
      />,
    );
    expect(await screen.findByRole("img", { name: "AL" })).toBeInTheDocument();

    // When
    view.rerender(
      <ContactAvatar
        vaultId="vault-1"
        contactId="contact-1"
        firstName="Ada"
        lastName="Lovelace"
        updatedAt=""
      />,
    );
    await act(async () => {
      replacement.resolve({ data: new Blob() });
      await replacement.promise;
    });

    // Then
    expectFallback("AL", probe);
    expect(probe.createObjectURL).toHaveBeenCalledOnce();
    expect(probe.revokeObjectURL.mock.calls).toEqual([["blob:version-1"]]);
  });

  it("ignores an old response that resolves after the replacement response", async () => {
    // Given
    const oldRequest = createDeferred<AvatarResponse>();
    const replacement = createDeferred<AvatarResponse>();
    const probe = installObjectUrlProbe(["blob:replacement"]);
    vi.mocked(httpClient.instance.get)
      .mockReturnValueOnce(oldRequest.promise)
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
    view.rerender(
      <ContactAvatar
        vaultId="vault-2"
        contactId="contact-2"
        firstName="Grace"
        lastName="Hopper"
        updatedAt="version-2"
      />,
    );

    // When
    await act(async () => {
      replacement.resolve({ data: new Blob(["replacement"]) });
      await replacement.promise;
    });
    await act(async () => {
      oldRequest.resolve({ data: new Blob(["old"]) });
      await oldRequest.promise;
    });

    // Then
    expect(screen.getByRole("img", { name: "GH" })).toHaveAttribute(
      "src",
      "blob:replacement",
    );
    expect(probe.createObjectURL).toHaveBeenCalledOnce();
    expect(probe.revokeObjectURL).not.toHaveBeenCalled();
    expect(probe.revokedWhileRendered).toEqual([]);
  });

  it("revokes each created URL exactly once on replacement and unmount", async () => {
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
    view.unmount();

    // Then
    expect(probe.revokedWhileRendered).toEqual([]);
    expect(probe.revokeObjectURL.mock.calls).toEqual([
      ["blob:version-1"],
      ["blob:version-2"],
    ]);
  });

  it("revokes the mounted avatar URL exactly once on unmount", async () => {
    // Given
    const probe = installObjectUrlProbe(["blob:mounted"]);
    vi.mocked(httpClient.instance.get).mockResolvedValue({
      data: new Blob(["avatar"]),
    });
    const view = render(
      <ContactAvatar
        vaultId="vault-1"
        contactId="contact-1"
        firstName="Ada"
        lastName="Lovelace"
      />,
    );
    expect(await screen.findByRole("img", { name: "AL" })).toHaveAttribute(
      "src",
      "blob:mounted",
    );

    // When
    view.unmount();

    // Then
    expect(probe.revokedWhileRendered).toEqual([]);
    expect(probe.revokeObjectURL).toHaveBeenCalledOnce();
    expect(probe.revokeObjectURL).toHaveBeenCalledWith("blob:mounted");
  });
});

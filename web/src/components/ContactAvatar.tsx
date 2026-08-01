import { useEffect, useMemo, useRef, useState } from "react";
import { httpClient } from "@/api";

type AvatarRequestIdentity = {
  readonly vaultId: string;
  readonly contactId: string;
  readonly updatedAt?: string;
};

const AVATAR_COLORS = [
  "#f56a00",
  "#7265e6",
  "#ffbf00",
  "#00a2ae",
  "#87d068",
  "#1677ff",
  "#722ed1",
  "#eb2f96",
  "#fa8c16",
  "#13c2c2",
  "#2f54eb",
  "#52c41a",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function ContactAvatar({
  vaultId,
  contactId,
  firstName,
  lastName,
  size = 34,
  updatedAt,
}: {
  vaultId: string;
  contactId: string;
  firstName?: string;
  lastName?: string;
  size?: number;
  updatedAt?: string;
}) {
  const requestIdentity = useMemo<AvatarRequestIdentity>(
    () => ({ vaultId, contactId, updatedAt }),
    [vaultId, contactId, updatedAt],
  );
  const ownedObjectUrlRef = useRef<string | null>(null);
  const [avatar, setAvatar] = useState<{
    readonly url: string;
    readonly requestIdentity: AvatarRequestIdentity;
  } | null>(null);

  const initials =
    `${(firstName ?? "").charAt(0)}${(lastName ?? "").charAt(0)}`.toUpperCase() ||
    "?";
  const bgColor = getAvatarColor((firstName ?? "") + (lastName ?? ""));

  useEffect(() => {
    let active = true;
    const {
      vaultId: requestVaultId,
      contactId: requestContactId,
      updatedAt: requestUpdatedAt,
    } = requestIdentity;

    httpClient.instance
      .get<Blob>(
        `/vaults/${requestVaultId}/contacts/${requestContactId}/avatar`,
        {
          responseType: "blob",
          params: requestUpdatedAt ? { t: requestUpdatedAt } : undefined,
        },
      )
      .then(
        (response) => {
          if (!active) return;
          const blob = response.data;
          if (blob.size === 0) {
            setAvatar(null);
            return;
          }
          const url = URL.createObjectURL(blob);
          ownedObjectUrlRef.current = url;
          setAvatar({ url, requestIdentity });
        },
        () => {
          if (active) setAvatar(null);
        },
      );

    return () => {
      active = false;
      const ownedUrl = ownedObjectUrlRef.current;
      ownedObjectUrlRef.current = null;
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [requestIdentity]);

  const containerStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.max(8, size * 0.25),
    backgroundColor: bgColor,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: Math.max(size * 0.38, 11),
    fontWeight: 600,
    flexShrink: 0,
    overflow: "hidden",
    letterSpacing: 0.5,
  };

  if (avatar?.requestIdentity === requestIdentity) {
    return (
      <div style={containerStyle}>
        <img
          src={avatar.url}
          alt={initials}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  return <div style={containerStyle}>{initials}</div>;
}

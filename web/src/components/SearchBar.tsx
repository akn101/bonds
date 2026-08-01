import { useState, useRef, useCallback } from "react";
import { AutoComplete } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { SearchResponse, SearchResult } from "@/api";
import {
  buildContactSourcePath,
  parseCanonicalPositiveSafeInteger,
} from "@/utils/feedSourceLink";

type SearchOption = {
  readonly value: string;
  readonly label: string;
};

type SearchOptionGroup = {
  readonly label: string;
  readonly options: SearchOption[];
};

function buildContactOption(
  vaultId: string,
  result: SearchResult,
): SearchOption | null {
  if (typeof result.id !== "string") return null;
  return {
    value: `/vaults/${vaultId}/contacts/${result.id}`,
    label: result.name ?? "",
  };
}

function buildNoteOption(
  vaultId: string,
  result: SearchResult,
): SearchOption | null {
  if (typeof result.id !== "string" || typeof result.contact_id !== "string") {
    return null;
  }

  const noteId = parseCanonicalPositiveSafeInteger(result.id);
  if (noteId === null) return null;

  return {
    value: buildContactSourcePath(vaultId, result.contact_id, {
      available: true,
      id: noteId,
      kind: "Note",
      module: "notes",
    }),
    label: result.name ?? "",
  };
}

export default function SearchBar() {
  const [options, setOptions] = useState<SearchOptionGroup[]>([]);
  // Bug #31 fix: Controlled value prevents Ant Design AutoComplete from writing
  // the selected option value (e.g. "contact:uuid") back into the input field.
  const [value, setValue] = useState("");
  const { id: vaultId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback(
    (searchText: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (!searchText || !vaultId) {
        setOptions([]);
        return;
      }
      timerRef.current = setTimeout(async () => {
        try {
          const res = await api.search.searchList(String(vaultId), {
            q: searchText,
          });
          const data: SearchResponse | undefined = res.data;
          const groups: SearchOptionGroup[] = [];

          if (data?.contacts?.length) {
            const contactOptions = data.contacts.flatMap((contact) => {
              const option = buildContactOption(vaultId, contact);
              return option ? [option] : [];
            });
            groups.push({
              label: t("search.contacts"),
              options: contactOptions,
            });
          }
          if (data?.notes?.length) {
            const noteOptions = data.notes.flatMap((note) => {
              const option = buildNoteOption(vaultId, note);
              return option ? [option] : [];
            });
            if (noteOptions.length > 0) {
              groups.push({
                label: t("search.notes"),
                options: noteOptions,
              });
            }
          }
          if (groups.length === 0) {
            groups.push({
              label: t("search.noResults"),
              options: [],
            });
          }
          setOptions(groups);
        } catch {
          setOptions([]);
        }
      }, 300);
    },
    [vaultId, t],
  );

  const handleSelect = useCallback(
    (selectedValue: string) => {
      if (!vaultId) return;
      navigate(selectedValue);
      setValue("");
      setOptions([]);
    },
    [vaultId, navigate],
  );

  if (!vaultId) return null;

  return (
    // Fix: Don't nest <Input> inside AutoComplete — it causes double-input rendering
    // (text appears both inside and outside the input box). Use AutoComplete's own
    // props (placeholder, allowClear, variant) with a CSS-positioned search icon.
    // The icon uses pointer-events:none so clicks pass through to the input.
    // Bug #59 fix: padding-left on the input must be >= icon left + icon size + gap
    // to prevent text/icon overlap.
    <div className="bonds-search-bar">
      <SearchOutlined className="bonds-search-bar-icon" />
      <AutoComplete
        value={value}
        options={options}
        onSearch={handleSearch}
        onSelect={handleSelect}
        onChange={setValue}
        placeholder={t("search.placeholder")}
        allowClear
        style={{ width: "100%" }}
        variant="borderless"
        popupMatchSelectWidth={280}
        classNames={{ popup: { root: "bonds-search-dropdown" } }}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { AutoComplete, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { AddressSuggestionItem } from "@/api";

const { Text } = Typography;

// Nominatim allows one request per second and the server queues on top of that,
// so the box waits for a pause in typing rather than firing per keystroke.
const DEBOUNCE_MS = 450;
// Below this a query matches most of the planet and the answers are useless.
const MIN_QUERY_LENGTH = 3;

type Props = {
  vaultId: string;
  /** Called with the picked candidate so the caller can fill its own form. */
  onPick: (suggestion: AddressSuggestionItem) => void;
};

/**
 * Looks up a real address and hands the whole structured result back.
 *
 * Renders nothing at all when the instance has no geocoding provider
 * configured — a lookup box that can never return anything is worse than no box.
 */
export default function AddressAutocomplete({ vaultId, onPick }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [options, setOptions] = useState<{ value: string; label: React.ReactNode }[]>([]);
  const [suggestions, setSuggestions] = useState<AddressSuggestionItem[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Slow answers can arrive after newer ones; only the latest may win.
  const requestRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const search = (query: string) => {
    setValue(query);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setOptions([]);
      setSuggestions([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const request = ++requestRef.current;
      setSearching(true);
      try {
        const res = await api.addresses.addressesSuggestList(vaultId, { q: query });
        if (request !== requestRef.current) return;
        const data = res.data;
        setEnabled(data?.enabled !== false);
        const items: AddressSuggestionItem[] = data?.suggestions ?? [];
        setSuggestions(items);
        setOptions(
          items.map((item, index) => ({
            value: String(index),
            label: <span style={{ whiteSpace: "normal" }}>{item.label}</span>,
          })),
        );
      } catch {
        // A failed or rate-limited lookup just means no suggestions; the reader
        // can always type the address themselves.
        if (request === requestRef.current) {
          setOptions([]);
          setSuggestions([]);
        }
      } finally {
        if (request === requestRef.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
  };

  if (!enabled) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <AutoComplete
        // Controlled, because an uncontrolled AutoComplete writes the selected
        // option's value — here an array index — back into the input.
        value={value}
        options={options}
        onSearch={search}
        onChange={setValue}
        onSelect={(selected: string) => {
          const suggestion = suggestions[Number(selected)];
          if (!suggestion) return;
          onPick(suggestion);
          setValue("");
          setOptions([]);
        }}
        style={{ width: "100%" }}
        allowClear
        placeholder={t("modules.addresses.lookup_placeholder")}
        aria-label={t("modules.addresses.lookup_label")}
        notFoundContent={
          searching ? t("modules.addresses.lookup_searching") : value.trim().length >= MIN_QUERY_LENGTH ? t("modules.addresses.lookup_no_results") : null
        }
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t("modules.addresses.lookup_hint")}{" "}
        {/* Results come from OpenStreetMap, whose ODbL licence requires that
            the data be credited wherever it is shown. */}
        <span style={{ opacity: 0.75 }}>{t("modules.addresses.lookup_attribution")}</span>
      </Text>
    </div>
  );
}

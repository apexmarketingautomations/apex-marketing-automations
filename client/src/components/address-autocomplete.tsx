import { useRef, useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";

export interface AddressData {
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface AddressAutocompleteProps {
  value?: string;
  onAddressSelect: (data: AddressData) => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  types?: string[];
  "data-testid"?: string;
}

export function AddressAutocomplete({
  value = "",
  onAddressSelect,
  onChange,
  placeholder = "Start typing an address...",
  className = "",
  types = ["address"],
  "data-testid": testId,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const [inputValue, setInputValue] = useState(value);
  const onAddressSelectRef = useRef(onAddressSelect);
  onAddressSelectRef.current = onAddressSelect;

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const initAutocomplete = useCallback(() => {
    if (!inputRef.current || !window.google?.maps?.places || autocompleteRef.current) return;

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "us" },
      types,
      fields: ["address_components", "formatted_address"],
    });

    listenerRef.current = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place.address_components) return;

      let streetNumber = "";
      let route = "";
      let city = "";
      let state = "";
      let zip = "";

      for (const component of place.address_components) {
        const type = component.types[0];
        switch (type) {
          case "street_number":
            streetNumber = component.long_name;
            break;
          case "route":
            route = component.long_name;
            break;
          case "locality":
            city = component.long_name;
            break;
          case "administrative_area_level_1":
            state = component.short_name;
            break;
          case "postal_code":
            zip = component.long_name;
            break;
        }
      }

      const street = streetNumber ? `${streetNumber} ${route}` : route;
      const addressData: AddressData = { address: street, city, state, zip };
      setInputValue(place.formatted_address || street);
      onAddressSelectRef.current(addressData);
    });

    autocompleteRef.current = autocomplete;
  }, [types]);

  useEffect(() => {
    let checkInterval: ReturnType<typeof setInterval> | null = null;

    if (window.google?.maps?.places) {
      initAutocomplete();
    } else {
      checkInterval = setInterval(() => {
        if (window.google?.maps?.places) {
          clearInterval(checkInterval!);
          checkInterval = null;
          initAutocomplete();
        }
      }, 500);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
      if (listenerRef.current) {
        google.maps.event.removeListener(listenerRef.current);
        listenerRef.current = null;
      }
      autocompleteRef.current = null;
    };
  }, [initAutocomplete]);

  return (
    <Input
      ref={inputRef}
      value={inputValue}
      onChange={(e) => {
        setInputValue(e.target.value);
        onChange?.(e.target.value);
      }}
      placeholder={placeholder}
      className={className}
      data-testid={testId}
    />
  );
}

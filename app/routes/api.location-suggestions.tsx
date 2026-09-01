import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface SuggestionItem {
  id: string;
  description: string;
  mainText: string;
  secondaryText: string;
  address1: string;
  city: string;
  province: string;
  zip: string;
  countryCode: string;
  country: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  let cors = (res: Response) => res;
  let storeDomain = "";

  try {
    const authResult = await authenticate.public.customerAccount(request);
    cors = authResult.cors;
    if (authResult.sessionToken?.dest) {
      storeDomain = authResult.sessionToken.dest.replace(/^https?:\/\//, "");
    }
  } catch (e) {
    cors = (res: Response) => {
      const newHeaders = new Headers(res.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      newHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: newHeaders,
      });
    };
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const shopParam = url.searchParams.get("shop")?.trim();
  if (shopParam) storeDomain = shopParam;

  if (!q || q.length < 2) {
    return cors(Response.json({ suggestions: [] }));
  }

  const suggestions = await fetchLocationSuggestions(q, storeDomain);
  return cors(Response.json({ suggestions }));
}

export async function action({ request }: ActionFunctionArgs) {
  let cors = (res: Response) => res;
  let storeDomain = "";

  try {
    const authResult = await authenticate.public.customerAccount(request);
    cors = authResult.cors;
    if (authResult.sessionToken?.dest) {
      storeDomain = authResult.sessionToken.dest.replace(/^https?:\/\//, "");
    }
  } catch (e) {
    cors = (res: Response) => {
      const newHeaders = new Headers(res.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      newHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: newHeaders,
      });
    };
  }

  if (request.method === "OPTIONS") {
    return cors(new Response(null, { status: 200 }));
  }

  try {
    const body = await request.json().catch(() => ({}));
    const q = (body.q || "").trim();
    if (body.shop) storeDomain = String(body.shop).trim();

    if (!q || q.length < 2) {
      return cors(Response.json({ suggestions: [] }));
    }

    const suggestions = await fetchLocationSuggestions(q, storeDomain);
    return cors(Response.json({ suggestions }));
  } catch (err) {
    return cors(Response.json({ suggestions: [] }));
  }
}

async function fetchLocationSuggestions(query: string, storeDomain?: string): Promise<SuggestionItem[]> {
  let googleApiKey = "";
  const cleanDomain = storeDomain ? storeDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase().trim() : "";

  // 1. Load merchant's Google API key strictly for this specific shop from DB
  if (cleanDomain) {
    try {
      const googleConfig = await db.googlePlacesConfig.findUnique({
        where: { shop: cleanDomain },
      });
      if (googleConfig?.apiKey && googleConfig.apiKey.trim().length > 0) {
        googleApiKey = googleConfig.apiKey.trim();
      }
    } catch (e) {
      console.warn("[api.location-suggestions] DB lookup error for shop:", cleanDomain, e);
    }
  }

  if (!googleApiKey) {
    return [];
  }

  // ── Strategy A: Google Places API (New) ───────────────────────────────────
  try {
    const newPlacesUrl = "https://places.googleapis.com/v1/places:autocomplete";
    const resNew = await fetch(newPlacesUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleApiKey,
      },
      body: JSON.stringify({ input: query }),
    });

    if (resNew.ok) {
      const dataNew = await resNew.json();
      if (Array.isArray(dataNew.suggestions) && dataNew.suggestions.length > 0) {
        const items: SuggestionItem[] = [];

        for (const s of dataNew.suggestions.slice(0, 5)) {
          const pred = s.placePrediction;
          if (!pred) continue;

          const rawPlaceId = pred.placeId || (pred.place ? pred.place.replace(/^places\//, "") : "");
          const mainText = pred.structuredFormat?.mainText?.text || query;
          const secondaryText = pred.structuredFormat?.secondaryText?.text || "";
          const description = pred.text?.text || `${mainText}, ${secondaryText}`;

          let address1 = mainText;
          let city = mainText;
          let province = "";
          let zip = "";
          let countryCode = "";
          let country = "";

          // Optionally fetch detail from Places (New)
          if (rawPlaceId) {
            try {
              const detailRes = await fetch(`https://places.googleapis.com/v1/places/${rawPlaceId}`, {
                headers: {
                  "X-Goog-Api-Key": googleApiKey,
                  "X-Goog-FieldMask": "addressComponents,formattedAddress",
                },
              });

              if (detailRes.ok) {
                const detailData = await detailRes.json();
                const comps = detailData.addressComponents || [];
                let streetNum = "";
                let route = "";
                let neighborhood = "";

                for (const c of comps) {
                  const types = c.types || [];
                  if (types.includes("street_number")) streetNum = c.longText || c.shortText;
                  if (types.includes("route")) route = c.longText || c.shortText;
                  if (types.includes("sublocality") || types.includes("neighborhood") || types.includes("sublocality_level_1")) {
                    neighborhood = c.longText || c.shortText;
                  }
                  if (types.includes("locality") || types.includes("postal_town")) {
                    city = c.longText || c.shortText;
                  }
                  if (!city && (types.includes("administrative_area_level_2") || types.includes("sublocality_level_1"))) {
                    city = c.longText || c.shortText;
                  }
                  if (types.includes("administrative_area_level_1")) province = c.longText || c.shortText;
                  if (types.includes("postal_code")) zip = c.longText || c.shortText;
                  if (types.includes("country")) {
                    country = c.longText || c.shortText;
                    countryCode = (c.shortText || "").toUpperCase();
                  }
                }

                if (!city) city = neighborhood || mainText;
                address1 = [streetNum, route].filter(Boolean).join(" ") || neighborhood || mainText;
              }
            } catch (e) {
              // fallback to structured text
            }
          }

          items.push({
            id: rawPlaceId || String(Math.random()),
            description,
            mainText,
            secondaryText,
            address1: address1 || mainText,
            city: city || mainText,
            province,
            zip,
            countryCode,
            country,
          });
        }

        if (items.length > 0) {
          return items;
        }
      }
    }
  } catch (e) {
    // try strategy B
  }

  // ── Strategy B: Google Places API (Legacy) ────────────────────────────────
  try {
    const gUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=geocode&key=${googleApiKey}`;
    const res = await fetch(gUrl);
    const data = await res.json();

    if (data.status === "OK" && Array.isArray(data.predictions) && data.predictions.length > 0) {
      const googleItems: SuggestionItem[] = [];

      for (const pred of data.predictions.slice(0, 5)) {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${pred.place_id}&fields=address_components,formatted_address&key=${googleApiKey}`;
        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();

        if (detailData.status === "OK" && detailData.result) {
          const comps = detailData.result.address_components || [];
          let streetNum = "";
          let route = "";
          let neighborhood = "";
          let city = "";
          let province = "";
          let zip = "";
          let countryCode = "";
          let country = "";

          for (const c of comps) {
            const types = c.types || [];
            if (types.includes("street_number")) streetNum = c.long_name;
            if (types.includes("route")) route = c.long_name;
            if (types.includes("sublocality") || types.includes("neighborhood") || types.includes("sublocality_level_1")) {
              neighborhood = c.long_name;
            }
            if (types.includes("locality") || types.includes("postal_town")) {
              city = c.long_name;
            }
            if (!city && (types.includes("administrative_area_level_2") || types.includes("sublocality_level_1"))) {
              city = c.long_name;
            }
            if (types.includes("administrative_area_level_1")) province = c.long_name;
            if (types.includes("postal_code")) zip = c.long_name;
            if (types.includes("country")) {
              country = c.long_name;
              countryCode = (c.short_name || "").toUpperCase();
            }
          }

          if (!city) {
            city = neighborhood || (pred.structured_formatting?.main_text || "").replace(/\d+/g, "").trim();
          }

          const address1 =
            [streetNum, route].filter(Boolean).join(" ") ||
            neighborhood ||
            pred.structured_formatting?.main_text ||
            "";

          googleItems.push({
            id: pred.place_id,
            description: detailData.result.formatted_address || pred.description,
            mainText: pred.structured_formatting?.main_text || query,
            secondaryText: pred.structured_formatting?.secondary_text || "",
            address1,
            city,
            province,
            zip,
            countryCode,
            country,
          });
        }
      }

      if (googleItems.length > 0) {
        return googleItems;
      }
    } else if (data.status === "REQUEST_DENIED") {
      console.warn(`[api.location-suggestions] Google Places API rejected key: ${data.error_message || "REQUEST_DENIED"}`);
    }
  } catch (e) {
    console.warn("[api.location-suggestions] Legacy Google Places API fetch error:", e);
  }

  /*
  // ── OpenStreetMap Nominatim Fallback (Disabled) ─────────────────────────
  */

  return [];
}

import { useState, useEffect, useRef } from 'preact/hooks';

const SEARCH_QUERY = `#graphql
  query SearchProducts($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      nodes {
        id
        title
        featuredImage {
          url
          altText
        }
        variants(first: 25) {
          nodes {
            id
            title
            availableForSale
            selectedOptions {
              name
              value
            }
            price {
              amount
              currencyCode
            }
            image {
              url
              altText
            }
          }
        }
      }
    }
  }
`;

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

/**
 * Debounced product search against the storefront catalog.
 * Uses shopify.query(), which requires the `api_access` capability
 * (already enabled in shopify.extension.toml) — no backend call needed.
 */
export function useProductSearch(searchTerm) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    clearTimeout(timeoutRef.current);

    const term = searchTerm.trim();
    if (term.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    timeoutRef.current = setTimeout(async () => {
      try {
        const { data, errors } = await shopify.query(SEARCH_QUERY, {
          variables: { query: `title:*${term}*`, first: 10 },
        });

        if (errors?.length) {
          throw new Error(errors[0].message);
        }

        setResults(data?.products?.nodes ?? []);
      } catch (err) {
        setError(err.message || 'Something went wrong while searching.');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutRef.current);
  }, [searchTerm]);

  return { results, loading, error };
}

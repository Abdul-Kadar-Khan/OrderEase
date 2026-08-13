import { useState, useEffect } from 'preact/hooks';
import { getUpsellTags } from '../utils/api';

/**
 * GraphQL query against the Storefront API to find products matching tags.
 * shopify.query() in Customer Account extensions targets the Storefront API.
 */
const PRODUCTS_BY_TAG_QUERY = `#graphql
  query SearchProductsByTag($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      nodes {
        id
        title
        featuredImage {
          url
          altText
        }
        variants(first: 10) {
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
          }
        }
      }
    }
  }
`;

const FALLBACK_PRODUCTS_QUERY = `#graphql
  query SearchPopularProducts($first: Int!) {
    products(first: $first) {
      nodes {
        id
        title
        featuredImage {
          url
          altText
        }
        variants(first: 10) {
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
          }
        }
      }
    }
  }
`;

/**
 * Fetches upsell product recommendations based on tags of active order items.
 * If no specific upsell tags are found, falls back to top catalog products.
 */
export function useUpsellProducts(orderId) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;

    const fetchUpsells = async () => {
      setLoading(true);
      setError(null);
      setProducts([]);

      try {
        let fetched = [];

        // Step 1: try fetching upsell tags from our backend
        try {
          const { tags } = await getUpsellTags({ orderId });

          if (tags && tags.length > 0) {
            const tagQuery = tags.map((t) => `tag:"${t}"`).join(' OR ');
            const { data } = await shopify.query(PRODUCTS_BY_TAG_QUERY, {
              variables: { query: tagQuery, first: 8 },
            });
            fetched = data?.products?.nodes ?? [];
          }
        } catch (e) {
          console.warn('[useUpsellProducts] Tag query failed, using fallback catalog query:', e);
        }

        // Step 2: Fall back to general store catalog if no tag-matched products found
        if (fetched.length === 0) {
          const { data } = await shopify.query(FALLBACK_PRODUCTS_QUERY, {
            variables: { first: 8 },
          });
          fetched = data?.products?.nodes ?? [];
        }

        // Step 3: Filter out any products already in the customer's order
        const lines = shopify.lines.value ?? [];
        const orderProductIds = new Set(
          lines
            .filter((l) => l.merchandise?.product?.id && l.currentQuantity !== 0)
            .map((l) => l.merchandise.product.id)
        );

        const deduped = fetched.filter((p) => !orderProductIds.has(p.id));

        if (!cancelled) {
          setProducts(deduped);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setError(err.message || 'Could not load recommendations.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchUpsells();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return { products, loading, error };
}

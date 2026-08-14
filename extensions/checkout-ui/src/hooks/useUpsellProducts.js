import { useState, useEffect } from 'preact/hooks';
import { getUpsellTags } from '../utils/api';
import { getExtensionLines, getExtensionOrderId, formatOrderId } from '../utils/shopifyHelpers';

/**
 * GraphQL query against the Storefront API to find products matching tags.
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

/**
 * Fetches upsell product recommendations based on tags of active order items.
 */
export function useUpsellProducts(initialOrderId) {
  const normalizedInitial = formatOrderId(initialOrderId);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resolvedOrderId, setResolvedOrderId] = useState(normalizedInitial || getExtensionOrderId());

  useEffect(() => {
    let active = true;
    let attempts = 0;
    const maxAttempts = 30;

    const normalized = formatOrderId(initialOrderId);
    if (normalized) {
      setResolvedOrderId(normalized);
      return;
    }

    const currentId = getExtensionOrderId();
    if (currentId) {
      setResolvedOrderId(currentId);
      return;
    }

    const interval = setInterval(() => {
      attempts++;
      const foundId = getExtensionOrderId();
      if (foundId && active) {
        setResolvedOrderId(foundId);
        clearInterval(interval);
      } else if (attempts >= maxAttempts && active) {
        clearInterval(interval);
      }
    }, 300);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [initialOrderId]);

  useEffect(() => {
    if (!resolvedOrderId) return;

    let cancelled = false;

    const fetchUpsells = async () => {
      setLoading(true);
      setError(null);
      setProducts([]);

      try {
        const { tags } = await getUpsellTags({ orderId: resolvedOrderId });

        if (!tags || tags.length === 0) {
          if (!cancelled) setProducts([]);
          return;
        }

        const tagQuery = tags.map((t) => `tag:"${t}"`).join(' OR ');

        const { data, errors } = await shopify.query(PRODUCTS_BY_TAG_QUERY, {
          variables: { query: tagQuery, first: 8 },
        });

        if (errors?.length) {
          throw new Error(errors[0].message);
        }

        const fetched = data?.products?.nodes ?? [];

        const lines = getExtensionLines();
        const orderProductIds = new Set(
          lines
            .filter((l) => l.merchandise?.product?.id && (l.currentQuantity !== 0 && l.quantity !== 0))
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
  }, [resolvedOrderId]);

  return { products, loading, error, resolvedOrderId };
}

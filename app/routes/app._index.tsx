import { useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useNavigate, useLocation } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    navigate(`/app/active-services${location.search}`, { replace: true });
  }, [navigate, location.search]);

  return null;
}


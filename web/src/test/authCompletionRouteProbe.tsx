import { useLocation } from "react-router-dom";

export function RouteLocationProbe() {
  const location = useLocation();
  return <output data-testid="route-location">{location.pathname}</output>;
}

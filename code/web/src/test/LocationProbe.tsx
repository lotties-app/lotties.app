import { useLocation } from 'react-router-dom';

/** The current URL (path and query) in a hidden element, for assertions (`getByTestId('location')`). */
export function LocationProbe() {
  const location = useLocation();
  return (
    <span hidden data-testid="location">
      {location.pathname + location.search}
    </span>
  );
}

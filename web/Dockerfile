FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public, non-secret build-time configuration baked into the SPA bundle.
# Exported as ENV so they also win over any web/.env* file copied into the build context.
ARG VITE_API_BASE_URL=""
ARG VITE_OIDC_AUTHORITY=""
ARG VITE_OIDC_CLIENT_ID=""
ARG VITE_OIDC_AUDIENCE=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID \
    VITE_OIDC_AUDIENCE=$VITE_OIDC_AUDIENCE
RUN npm run build

FROM nginx:1.27-alpine
ARG VITE_OIDC_AUTHORITY=""
# The nginx image renders /etc/nginx/templates/*.template with envsubst at start-up (only variables
# that are defined in the environment are substituted, so nginx's own $variables are untouched).
COPY nginx.conf /etc/nginx/templates/default.conf.template
# OIDC_ORIGIN (scheme://host[:port] of the OIDC authority) is allowed in the CSP connect-src.
# It defaults to the origin of VITE_OIDC_AUTHORITY and can be overridden at run time via the
# OIDC_ORIGIN environment variable. *.envsh files are sourced by the nginx entrypoint before envsubst runs.
RUN origin="$(printf '%s' "$VITE_OIDC_AUTHORITY" | sed -E 's#^(https?://[^/]+).*#\1#')" \
 && printf 'export OIDC_ORIGIN="${OIDC_ORIGIN:-%s}"\n' "$origin" > /docker-entrypoint.d/10-oidc-origin.envsh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

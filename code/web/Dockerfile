FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public, non-secret build-time configuration baked into the SPA bundle.
# Exported as ENV so they also win over any code/web/.env* file copied into the build context.
ARG VITE_API_BASE_URL=""
ARG VITE_OIDC_AUTHORITY=""
ARG VITE_OIDC_CLIENT_ID=""
ARG VITE_OIDC_AUDIENCE=""
# Source repository link in the landing footer (AGPL source offer); empty hides the link.
ARG VITE_REPO_URL=""
# Privacy policy contacts the owner publishes (docs/PRIVACY-OWNER-CHECKLIST.md); empty = the policy's defaults.
ARG VITE_PRIVACY_CONTROLLER_NAME=""
ARG VITE_PRIVACY_CONTACT_EMAIL=""
ARG VITE_PRIVACY_DPO=""
# The release stamped by deploy/homelab/deploy.sh, shown on the About screen (vite.config.ts, build-info.ts):
# APP_VERSION X.Y.Z (empty: "dev"), APP_COMMIT the short commit (the image build has no git checkout; empty hides
# it), APP_BUILD_TIME an ISO time (empty: the time of `npm run build`).
ARG APP_VERSION=""
ARG APP_COMMIT=""
ARG APP_BUILD_TIME=""
ENV APP_VERSION=$APP_VERSION \
    APP_COMMIT=$APP_COMMIT \
    APP_BUILD_TIME=$APP_BUILD_TIME \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID \
    VITE_OIDC_AUDIENCE=$VITE_OIDC_AUDIENCE \
    VITE_REPO_URL=$VITE_REPO_URL \
    VITE_PRIVACY_CONTROLLER_NAME=$VITE_PRIVACY_CONTROLLER_NAME \
    VITE_PRIVACY_CONTACT_EMAIL=$VITE_PRIVACY_CONTACT_EMAIL \
    VITE_PRIVACY_DPO=$VITE_PRIVACY_DPO
RUN npm run build

# Non-root nginx: runs as uid 101 and listens on 8080. Works with a read-only root filesystem when /tmp (pid, temp
# files) and /etc/nginx/conf.d (where the entrypoint renders default.conf) are writable, e.g. tmpfs or emptyDir.
FROM nginxinc/nginx-unprivileged:1.27-alpine
ARG VITE_OIDC_AUTHORITY=""
# The build steps below need root; the image switches back to uid 101 at the end.
USER root
# The nginx image renders /etc/nginx/templates/*.template with envsubst at start-up into /etc/nginx/conf.d.
COPY nginx.conf /etc/nginx/templates/default.conf.template
# *.envsh files in /docker-entrypoint.d are sourced by the entrypoint (as uid 101) before envsubst runs:
#  - OIDC_ORIGIN (scheme://host[:port] of the OIDC authority) is allowed in the CSP connect-src. It defaults to the
#    origin of VITE_OIDC_AUTHORITY and can be overridden at run time.
#  - API_UPSTREAM (host:port) is where /api/ is proxied; default api:8080, the compose service.
# The file is written as root and made world-readable and executable (the entrypoint skips non-executable files).
RUN origin="$(printf '%s' "$VITE_OIDC_AUTHORITY" | sed -E 's#^(https?://[^/]+).*#\1#')" \
 && printf 'export OIDC_ORIGIN="${OIDC_ORIGIN:-%s}"\nexport API_UPSTREAM="${API_UPSTREAM:-api:8080}"\n' "$origin" \
      > /docker-entrypoint.d/10-lotties-env.envsh \
 && chmod 0755 /docker-entrypoint.d/10-lotties-env.envsh
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS: the entrypoint exports NGINX_LOCAL_RESOLVERS (the nameservers of
# /etc/resolv.conf) for the `resolver` directive. NGINX_ENVSUBST_FILTER: only these variables are substituted in the
# template, so nginx's own $variables and any other environment variable are left untouched.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER="^(OIDC_ORIGIN|API_UPSTREAM|NGINX_LOCAL_RESOLVERS)\$"
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080

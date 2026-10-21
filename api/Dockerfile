FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY Directory.Build.props BabyRoutine.sln ./
COPY src ./src
COPY tests ./tests
RUN dotnet publish src/BabyRoutine.Api/BabyRoutine.Api.csproj -c Release -o /out --no-self-contained

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /out .
# Configuration (DB_*, AUTH_*, CORS_ALLOWED_ORIGINS) comes from the environment at run time; nothing secret is baked in.
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
# The aspnet image has no curl/wget; probe /health with bash's /dev/tcp.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3 && head -n1 <&3 | grep -q ' 200 '"]
# Built-in non-root user ("app", UID 1654) shipped with the .NET 8 images.
USER app
ENTRYPOINT ["dotnet", "BabyRoutine.Api.dll"]

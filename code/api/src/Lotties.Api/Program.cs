using Lotties.Api;
using Lotties.Api.Endpoints;
using Lotties.Infrastructure.Push;

if (VapidKeysCommand.TryRun(args, Console.Out))
{
    return;
}

var builder = WebApplication.CreateBuilder(args);
builder.AddLottiesApi();

var app = builder.Build();
app.UseLottiesApi();
app.MapLottiesApi();

await app.MigrateDatabaseIfEnabledAsync();
app.Run();

/// <summary>Entry point; public so integration tests can host the API with <c>WebApplicationFactory</c>.</summary>
public partial class Program;

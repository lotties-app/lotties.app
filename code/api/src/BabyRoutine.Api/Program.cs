using BabyRoutine.Api;
using BabyRoutine.Api.Endpoints;
using BabyRoutine.Infrastructure.Push;

if (VapidKeysCommand.TryRun(args, Console.Out))
{
    return;
}

var builder = WebApplication.CreateBuilder(args);
builder.AddBabyRoutineApi();

var app = builder.Build();
app.UseBabyRoutineApi();
app.MapBabyRoutineApi();

await app.MigrateDatabaseIfEnabledAsync();
app.Run();

/// <summary>Entry point; public so integration tests can host the API with <c>WebApplicationFactory</c>.</summary>
public partial class Program;

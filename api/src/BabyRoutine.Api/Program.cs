using BabyRoutine.Infrastructure;
using BabyRoutine.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddInfrastructure(DatabaseOptions.FromEnvironment());

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

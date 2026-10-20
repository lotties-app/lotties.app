using BabyRoutine.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(DatabaseOptions.FromEnvironment());

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

using BabyRoutine.Api;
using BabyRoutine.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);
builder.AddBabyRoutineApi();

var app = builder.Build();
app.UseBabyRoutineApi();
app.MapBabyRoutineApi();

app.Run();

/// <summary>Entry point; public so integration tests can host the API with <c>WebApplicationFactory</c>.</summary>
public partial class Program;

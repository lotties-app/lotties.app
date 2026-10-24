namespace Lotties.Api.Board;

/// <summary>The project board (section <c>Board</c>, env <c>Board__Enabled</c>); off by default: every route answers 404.</summary>
public sealed class BoardOptions
{
    public const string SectionName = "Board";

    public bool Enabled { get; set; }
}

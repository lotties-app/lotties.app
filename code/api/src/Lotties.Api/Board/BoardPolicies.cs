namespace Lotties.Api.Board;

/// <summary>
/// The board's authorization policies (docs/design/36-project-board.md section 4): an authenticated caller with the
/// permission claim. A user gets it from her board realm role (reader: read; writer: read, write; admin: all three), a key
/// from its scope (never admin). No baby membership is involved.
/// </summary>
public static class BoardPolicies
{
    public const string Read = "BoardRead";
    public const string Write = "BoardWrite";
    public const string Admin = "BoardAdmin";
}

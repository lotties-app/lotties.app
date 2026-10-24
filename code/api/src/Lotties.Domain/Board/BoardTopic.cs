using Lotties.Domain.Common;

namespace Lotties.Domain.Board;

/// <summary>
/// A topic of the project board (<c>privacy-legal</c>). The key never changes; topics are never deleted, only archived
/// (an archived topic keeps its items and takes no new ones). The ten seeded topics are <see cref="Seeded"/>.
/// </summary>
public sealed class BoardTopic
{
    public const int NameMaxLength = 80;
    public const int DescriptionMaxLength = 500;

    private BoardTopic()
    {
    }

    private BoardTopic(string key, DateTimeOffset now)
    {
        Key = key;
        CreatedAt = now;
        UpdatedAt = now;
    }

    public string Key { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;

    public string? Description { get; private set; }

    public int SortOrder { get; private set; }

    public bool Archived { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>The topics the migration seeds (docs/design/36 section 2): key, name, description, in display order.</summary>
    public static IReadOnlyList<(string Key, string Name, string Description)> Seeded { get; } =
    [
        ("product", "Product", "Features, behaviour and scope of the app."),
        ("doctor-access", "Doctor access", "The Doctor role, sections, the doctor's dashboard."),
        ("assistants-alexa-mcp", "Assistants (Alexa, MCP)", "Voice and AI assistants."),
        ("privacy-legal", "Privacy and legal", "Privacy policy, LGPD, consent, retention, the owner checklist."),
        ("mobile-stores", "Mobile and stores", "Capacitor apps, App Store and Google Play."),
        ("infrastructure-deploy", "Infrastructure and deploy", "Home lab, Keycloak, database, backups, deploys."),
        ("data-catalog", "Data and catalog", "Medicine catalog, vaccine schedule, age norms, imports."),
        ("predictions-ml", "Predictions and ML", "Heuristics, benchmarks, the cry detector."),
        ("design-ux", "Design and UX", "Visual identity, interaction, accessibility, copy."),
        ("process-meta", "Process and meta", "How the owner and the assistants work: worktrees, reviews, this board."),
    ];

    public static BoardTopic Create(string key, string name, string? description, int sortOrder, bool archived, DateTimeOffset now)
    {
        var state = Validate(name, description, sortOrder, archived);
        var topic = new BoardTopic(BoardTopicKeys.Required(key, "key"), UtcTime.Normalize(now));
        (topic.Name, topic.Description, topic.SortOrder, topic.Archived) = state;
        return topic;
    }

    /// <summary>Applies the editable state; returns whether anything changed (unchanged values keep <see cref="UpdatedAt"/>).</summary>
    public bool Edit(string name, string? description, int sortOrder, bool archived, DateTimeOffset now)
    {
        var state = Validate(name, description, sortOrder, archived);
        if (state == (Name, Description, SortOrder, Archived))
        {
            return false;
        }

        (Name, Description, SortOrder, Archived) = state;
        UpdatedAt = UtcTime.Normalize(now);
        return true;
    }

    private static (string Name, string? Description, int SortOrder, bool Archived) Validate(string name, string? description, int sortOrder, bool archived) =>
        (Text.Required(name, "name", NameMaxLength), Text.Optional(description, "description", DescriptionMaxLength), sortOrder, archived);
}

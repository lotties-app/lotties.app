namespace Lotties.Postgres.Tests.Support;

/// <summary>
/// The default collection: every test class in it shares one postgres:17 container. A later suite that needs its own
/// container (for example one that kills connections) defines its own collection with the same fixture.
/// </summary>
[CollectionDefinition(Name)]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>
{
    public const string Name = "Postgres";

    /// <summary>The trait value: <c>[Trait("Category", PostgresCollection.Category)]</c>.</summary>
    public const string Category = "Postgres";
}

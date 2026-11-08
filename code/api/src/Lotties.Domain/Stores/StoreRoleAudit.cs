namespace Lotties.Domain.Stores;

/// <summary>A reason the app role of a store can do more than it should (machine codes, never server text).</summary>
public enum StoreRoleFinding
{
    /// <summary>Superuser, or may create roles or databases, or bypasses row-level security.</summary>
    SuperuserLike,

    /// <summary>Owns (itself or through a role it belongs to) the schema <c>lotties</c> or an object in it.</summary>
    OwnsObjects,

    /// <summary>May create objects in schema <c>public</c>.</summary>
    CreatesInPublic,

    /// <summary>May create objects in schema <c>lotties</c> (only the migrator may).</summary>
    CreatesInStoreSchema,
}

/// <summary>
/// What the migrator found out about the app role of a store (docs/design/47-bring-your-own-database.md section 3.3 "Least
/// privilege"): the role the API uses for every request must only read and write the data tables. Any finding makes the role
/// too powerful and the store is refused (<c>store_role_too_powerful</c>) until the owner fixes it, because a leaked app
/// credential must not be able to change the schema or reach the rest of the database.
/// </summary>
public sealed record StoreRoleAudit
{
    private StoreRoleAudit(IReadOnlyList<StoreRoleFinding> findings)
    {
        Findings = findings;
    }

    /// <summary>A role with nothing to report.</summary>
    public static StoreRoleAudit LeastPrivilege { get; } = new([]);

    public IReadOnlyList<StoreRoleFinding> Findings { get; }

    public bool IsTooPowerful => Findings.Count > 0;

    /// <summary>The audit for these flags, one per <see cref="StoreRoleFinding"/>.</summary>
    public static StoreRoleAudit From(bool superuserLike, bool ownsObjects, bool createsInPublic, bool createsInStoreSchema)
    {
        var findings = new[]
        {
            (superuserLike, StoreRoleFinding.SuperuserLike),
            (ownsObjects, StoreRoleFinding.OwnsObjects),
            (createsInPublic, StoreRoleFinding.CreatesInPublic),
            (createsInStoreSchema, StoreRoleFinding.CreatesInStoreSchema),
        };
        return new StoreRoleAudit(findings.Where(finding => finding.Item1).Select(finding => finding.Item2).ToArray());
    }
}

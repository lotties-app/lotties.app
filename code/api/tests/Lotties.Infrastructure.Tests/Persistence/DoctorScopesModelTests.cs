using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model and migration checks of the doctor scopes (docs/design/16-doctor-access.md): two nullable text columns, null = the defaults.</summary>
public sealed class DoctorScopesModelTests
{
    [Fact]
    public void Members_DoctorScopesAreANullableCommaSeparatedColumn()
    {
        using var context = ModelTestContext.Create();

        var column = context.Entity<BabyMember>().FindProperty(nameof(BabyMember.DoctorScopes))!;

        Assert.Equal(("doctor_scopes", true, 128, typeof(string)), (column.GetColumnName(), column.IsNullable, column.GetMaxLength(), column.GetValueConverter()!.ProviderClrType));
    }

    [Fact]
    public void Invites_DoctorScopesAreANullableCommaSeparatedColumn()
    {
        using var context = ModelTestContext.Create();

        var column = context.Entity<Invite>().FindProperty(nameof(Invite.DoctorScopes))!;

        Assert.Equal(("doctor_scopes", true, 128, typeof(string)), (column.GetColumnName(), column.IsNullable, column.GetMaxLength(), column.GetValueConverter()!.ProviderClrType));
    }

    [Fact]
    public void Converter_StoresTheCodesInCanonicalOrder_AndReadsThemBack()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<BabyMember>().FindProperty(nameof(BabyMember.DoctorScopes))!.GetValueConverter()!;

        var stored = converter.ConvertToProvider(DoctorScopeSet.Create([DoctorScope.Notes, DoctorScope.DailyLog]));
        var read = (DoctorScopeSet?)converter.ConvertFromProvider("growth,vaccines");

        Assert.Equal("daily_log,notes", stored);
        Assert.Equal(["growth", "vaccines"], read!.Codes);
    }

    [Fact]
    public void Converter_NoScopesAtAllIsTheEmptyTextAndReadsBackAsNone()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<Invite>().FindProperty(nameof(Invite.DoctorScopes))!.GetValueConverter()!;

        Assert.Equal(string.Empty, converter.ConvertToProvider(DoctorScopeSet.None));
        Assert.Equal(DoctorScopeSet.None, converter.ConvertFromProvider(string.Empty));
    }

    [Fact]
    public void Converter_UnknownCodesFromANewerServer_AreIgnoredOnRead()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<BabyMember>().FindProperty(nameof(BabyMember.DoctorScopes))!.GetValueConverter()!;

        var read = (DoctorScopeSet?)converter.ConvertFromProvider("growth,future_section");

        Assert.Equal(["growth"], read!.Codes);
    }

    [Fact]
    public void IdempotentScript_DoctorScopesAddsTwoNullableColumnsAndNothingElse()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_DoctorScopes'", StringComparison.Ordinal)..];

        Assert.Contains("ALTER TABLE invites ADD doctor_scopes character varying(128);", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE baby_members ADD doctor_scopes character varying(128);", section, StringComparison.Ordinal);
        Assert.Equal(2, section.Split("ALTER TABLE", StringSplitOptions.None).Length - 1);
        Assert.DoesNotContain("UPDATE ", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
        Assert.DoesNotContain("NOT NULL", section, StringComparison.Ordinal);
    }
}

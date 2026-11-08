using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores.Migration;
using Npgsql;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// The owner's connection test (task T6) on a fake migrator session: coarse codes for every outcome, nothing migrated, locked or
/// written, and no database text or host in a result or a log line.
/// </summary>
public sealed class StoreConnectionTesterTests
{
    private const string Known = "20261107000000_DataBaseline";

    private readonly FakeSessions _sessions = new();
    private readonly CapturingLogger<StoreConnectionTester> _logger = new();
    private readonly DataStore _store = DataStore.Create(Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UnixEpoch);

    [Fact]
    public async Task Test_LeastPrivilegeEmptyStore_IsOkAndChangesNothing()
    {
        var result = await Tester().TestAsync(_store);

        Assert.Equal(StoreCheckResult.Ok, result);
        Assert.Equal((0, 0, true), (_sessions.Session!.Locks, _sessions.Session.Writes, _sessions.Session.Disposed));
    }

    [Fact]
    public async Task Test_RoleTooPowerful_ReturnsTheCodeAndFindings()
    {
        _sessions.Audit = StoreRoleAudit.From(superuserLike: true, ownsObjects: false, createsInPublic: true, createsInStoreSchema: false);

        var result = await Tester().TestAsync(_store);

        Assert.Equal("store_role_too_powerful", result.Code);
        Assert.Equal([StoreRoleFinding.SuperuserLike, StoreRoleFinding.CreatesInPublic], result.Findings);
    }

    [Fact]
    public async Task Test_ControlDatabase_IsSchemaConflict()
    {
        _sessions.HoldsControlTables = true;

        Assert.Equal("store_schema_conflict", (await Tester().TestAsync(_store)).Code);
    }

    [Fact]
    public async Task Test_SchemaOfAnotherStore_IsSchemaConflict()
    {
        _sessions.Meta = new StoreMetaSnapshot(Guid.NewGuid(), Guid.NewGuid(), Known, "Ready");

        Assert.Equal("store_schema_conflict", (await Tester().TestAsync(_store)).Code);
    }

    [Fact]
    public async Task Test_OwnSchemaUpToDate_IsOk()
    {
        _sessions.Meta = new StoreMetaSnapshot(_store.Id, Guid.NewGuid(), Known, "Ready");
        _sessions.Applied = [Known];

        Assert.True((await Tester().TestAsync(_store)).IsOk);
    }

    [Fact]
    public async Task Test_SchemaNewerThanThisApi_IsSchemaAhead()
    {
        _sessions.Applied = [Known, "20991231000000_Future"];

        Assert.Equal("store_schema_ahead", (await Tester().TestAsync(_store)).Code);
    }

    [Fact]
    public async Task Test_GuardRefusesTheHost_ReturnsTheGuardCode()
    {
        _sessions.OpenFailure = new StoreEndpointRejectedException(StoreEndpointFailure.BlockedAddress);

        Assert.Equal("endpoint_blocked_address", (await Tester().TestAsync(_store)).Code);
    }

    [Fact]
    public async Task Test_WrongPassword_IsAuthFailedWithoutTheServerText()
    {
        _sessions.OpenFailure = new PostgresException("password authentication failed for user \"secret_user\" at db.secret-host.com", "FATAL", "FATAL", PostgresErrorCodes.InvalidPassword);

        var result = await Tester().TestAsync(_store);

        Assert.Equal("store_credentials_rejected", result.Code);
        AssertNoLeak();
    }

    [Fact]
    public async Task Test_AppRoleCannotLogIn_IsAuthFailed()
    {
        _sessions.AuditFailure = new NpgsqlException("wrapper", new PostgresException("no pg_hba.conf entry for host secret_user", "FATAL", "FATAL", PostgresErrorCodes.InvalidAuthorizationSpecification));

        Assert.Equal("store_credentials_rejected", (await Tester().TestAsync(_store)).Code);
        AssertNoLeak();
    }

    [Fact]
    public async Task Test_ConnectionRefused_IsUnavailableWithoutTheServerText()
    {
        _sessions.OpenFailure = new NpgsqlException("Failed to connect to db.secret-host.com as secret_user");

        Assert.Equal("store_unavailable", (await Tester().TestAsync(_store)).Code);
        AssertNoLeak();
    }

    [Theory]
    [InlineData(StoreEndpointFailure.TlsFailed, "store_tls_failed")]
    [InlineData(StoreEndpointFailure.Unresolvable, "store_paused_or_unreachable")]
    [InlineData(StoreEndpointFailure.PortNotAllowed, "endpoint_port_not_allowed")]
    [InlineData(StoreEndpointFailure.InvalidCertificate, "endpoint_invalid_ca")]
    public async Task Test_EndpointFailure_KeepsTheGuardCodeOrTheStoreFailureClass(StoreEndpointFailure failure, string code)
    {
        _sessions.OpenFailure = new StoreEndpointRejectedException(failure);

        Assert.Equal(code, (await Tester().TestAsync(_store)).Code);
    }

    [Fact]
    public async Task Test_SocketTimeout_IsTheTimeoutClass()
    {
        _sessions.OpenFailure = new NpgsqlException("Exception while connecting to secret-host", new TimeoutException());

        var result = await Tester().TestAsync(_store);

        Assert.Equal(("store_timeout", StoreFailureClass.Timeout), (result.Code, result.Failure));
    }

    [Fact]
    public async Task Test_Cancelled_Propagates()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        _sessions.OpenFailure = new OperationCanceledException(cancelled.Token);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Tester().TestAsync(_store, cancelled.Token));
    }

    [Fact]
    public async Task ReadIdentity_SameDatabase_ReturnsTheStoreIdOnBothEndpointsAndChangesNothing()
    {
        _sessions.Meta = new StoreMetaSnapshot(_store.Id, Guid.NewGuid(), Known, "Ready");
        _sessions.AppStoreId = _store.Id;

        var identity = await Tester().ReadIdentityAsync(_store);

        Assert.Equal(new StoreDatabaseIdentity(_store.Id, _store.Id), identity);
        Assert.True(identity.IsOf(_store.Id));
        Assert.Equal((0, 0, true), (_sessions.Session!.Locks, _sessions.Session.Writes, _sessions.Session.Disposed));
    }

    [Fact]
    public async Task ReadIdentity_EmptyDatabase_ReturnsNoIdentityAndCreatesNothing()
    {
        var identity = await Tester().ReadIdentityAsync(_store);

        Assert.Equal(StoreDatabaseIdentity.None, identity);
        Assert.Equal((0, 0), (_sessions.Session!.Locks, _sessions.Session.Writes));
    }

    [Fact]
    public async Task ReadIdentity_AppEndpointOnAnotherDatabase_ReportsWhatEachEndpointSees()
    {
        _sessions.Meta = new StoreMetaSnapshot(_store.Id, Guid.NewGuid(), Known, "Ready");

        var identity = await Tester().ReadIdentityAsync(_store);

        Assert.Equal(new StoreDatabaseIdentity(_store.Id, null), identity);
        Assert.False(identity.IsOf(_store.Id));
    }

    [Fact]
    public async Task ReadIdentity_WrongPassword_ThrowsTheStoreFailureWithoutTheServerText()
    {
        _sessions.OpenFailure = new PostgresException("password authentication failed for user \"secret_user\" at db.secret-host.com", "FATAL", "FATAL", PostgresErrorCodes.InvalidPassword);

        var failure = await Assert.ThrowsAsync<StoreCredentialsRejectedException>(() => Tester().ReadIdentityAsync(_store));

        Assert.Null(failure.InnerException);
        Assert.DoesNotContain("secret", failure.Message, StringComparison.OrdinalIgnoreCase);
        AssertNoLeak();
    }

    [Fact]
    public async Task ReadIdentity_AppRoleCannotLogIn_ThrowsCredentialsRejected()
    {
        _sessions.Meta = new StoreMetaSnapshot(_store.Id, Guid.NewGuid(), Known, "Ready");
        _sessions.AppReadFailure = new NpgsqlException("wrapper", new PostgresException("no pg_hba.conf entry for host secret_user", "FATAL", "FATAL", PostgresErrorCodes.InvalidAuthorizationSpecification));

        await Assert.ThrowsAsync<StoreCredentialsRejectedException>(() => Tester().ReadIdentityAsync(_store));
        AssertNoLeak();
    }

    [Theory]
    [InlineData(StoreEndpointFailure.BlockedAddress, "endpoint_blocked_address")]
    [InlineData(StoreEndpointFailure.TlsFailed, "store_tls_failed")]
    [InlineData(StoreEndpointFailure.Unresolvable, "store_paused_or_unreachable")]
    public async Task ReadIdentity_EndpointFailure_ThrowsTheGuardCodeOrTheStoreFailureClass(StoreEndpointFailure failure, string code)
    {
        _sessions.OpenFailure = new StoreEndpointRejectedException(failure);

        var thrown = await Assert.ThrowsAnyAsync<DomainException>(() => Tester().ReadIdentityAsync(_store));

        Assert.Equal(code, thrown.Code);
    }

    [Fact]
    public async Task ReadIdentity_Cancelled_Propagates()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        _sessions.OpenFailure = new OperationCanceledException(cancelled.Token);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Tester().ReadIdentityAsync(_store, cancelled.Token));
    }

    private StoreConnectionTester Tester() => new(_sessions, _logger);

    private void AssertNoLeak()
    {
        var text = string.Join("|", _logger.Entries.Select(entry => entry.Message + string.Join(",", entry.Values)));
        Assert.DoesNotContain("secret", text, StringComparison.OrdinalIgnoreCase);
        Assert.All(_logger.Entries, entry => Assert.Null(entry.Exception));
    }

    private sealed class FakeSessions : IStoreMigrationSessionFactory
    {
        public FakeSession? Session { get; private set; }

        public Exception? OpenFailure { get; set; }

        public Exception? AuditFailure { get; set; }

        public StoreRoleAudit Audit { get; set; } = StoreRoleAudit.LeastPrivilege;

        public bool HoldsControlTables { get; set; }

        public string[] Applied { get; set; } = [];

        public StoreMetaSnapshot? Meta { get; set; }

        public Guid? AppStoreId { get; set; }

        public Exception? AppReadFailure { get; set; }

        public Task<IStoreMigrationSession> OpenAsync(DataStore store, CancellationToken cancellationToken = default)
        {
            if (OpenFailure is { } failure)
            {
                return Task.FromException<IStoreMigrationSession>(failure);
            }

            Session = new FakeSession(this);
            return Task.FromResult<IStoreMigrationSession>(Session);
        }
    }

    private sealed class FakeSession(FakeSessions settings) : IStoreMigrationSession
    {
        public IReadOnlyList<string> KnownMigrations { get; } = [Known];

        public int Locks { get; private set; }

        public int Writes { get; private set; }

        public bool Disposed { get; private set; }

        public Task<StoreRoleAudit> AuditAppRoleAsync(CancellationToken cancellationToken = default) =>
            settings.AuditFailure is { } failure ? Task.FromException<StoreRoleAudit>(failure) : Task.FromResult(settings.Audit);

        public Task<bool> HoldsControlTablesAsync(CancellationToken cancellationToken = default) => Task.FromResult(settings.HoldsControlTables);

        public Task<bool> TryAcquireLockAsync(CancellationToken cancellationToken = default)
        {
            Locks++;
            return Task.FromResult(true);
        }

        public Task ReleaseLockAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<IReadOnlyList<string>> GetAppliedMigrationsAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<string>>(settings.Applied);

        public Task<StoreMetaSnapshot?> ReadMetaAsync(CancellationToken cancellationToken = default) => Task.FromResult(settings.Meta);

        public Task<Guid?> ReadAppStoreIdAsync(CancellationToken cancellationToken = default) =>
            settings.AppReadFailure is { } failure ? Task.FromException<Guid?>(failure) : Task.FromResult(settings.AppStoreId);

        public Task MigrateAsync(CancellationToken cancellationToken = default)
        {
            Writes++;
            return Task.CompletedTask;
        }

        public Task WriteMetaAsync(Guid storeId, DataStoreState state, string schemaVersion, CancellationToken cancellationToken = default)
        {
            Writes++;
            return Task.CompletedTask;
        }

        public ValueTask DisposeAsync()
        {
            Disposed = true;
            return ValueTask.CompletedTask;
        }
    }
}

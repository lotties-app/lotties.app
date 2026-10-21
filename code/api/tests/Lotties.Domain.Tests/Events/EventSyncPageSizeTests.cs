using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Events;

public sealed class EventSyncPageSizeTests
{
    [Fact]
    public void From_Null_ReturnsDefault()
    {
        Assert.Equal(EventSyncPageSize.Default, EventSyncPageSize.From(null).Value);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(EventSyncPageSize.Max)]
    public void From_InRange_KeepsValue(int requested)
    {
        Assert.Equal(requested, EventSyncPageSize.From(requested).Value);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(EventSyncPageSize.Max + 1)]
    public void From_OutOfRange_ThrowsValidation(int requested)
    {
        Assert.Throws<DomainValidationException>(() => EventSyncPageSize.From(requested));
    }
}

using BabyRoutine.Application.Push;
using BabyRoutine.Domain.Notifications;
using BabyRoutine.Infrastructure.Push;

namespace BabyRoutine.Infrastructure.Tests.Push;

public sealed class VapidKeysTests
{
    [Fact]
    public void Generate_ReturnsMatchingRawP256Pair()
    {
        var pair = VapidKeys.Generate();

        Assert.Equal(65, Base64Url.TryDecode(pair.PublicKey)!.Length);
        Assert.Equal(0x04, Base64Url.TryDecode(pair.PublicKey)![0]);
        Assert.Equal(32, Base64Url.TryDecode(pair.PrivateKey)!.Length);
        Assert.Null(VapidKeys.FindProblem(pair.PublicKey, pair.PrivateKey));
        Assert.DoesNotContain(pair.PrivateKey, pair.ToString());
    }

    [Fact]
    public void TryRun_WithSwitch_PrintsEnvAssignmentsOfAValidPair()
    {
        using var output = new StringWriter();

        var ran = VapidKeysCommand.TryRun(["--urls", "http://localhost:5000", VapidKeysCommand.Switch], output);

        Assert.True(ran);
        var lines = output.ToString().Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Split('=', 2))
            .ToDictionary(pair => pair[0], pair => pair[1]);
        Assert.Equal([PushEnvironmentVariables.PublicKey, PushEnvironmentVariables.PrivateKey], lines.Keys);
        Assert.Null(VapidKeys.FindProblem(lines[PushEnvironmentVariables.PublicKey], lines[PushEnvironmentVariables.PrivateKey]));
    }

    [Fact]
    public void TryRun_WithoutSwitch_PrintsNothing()
    {
        using var output = new StringWriter();

        var ran = VapidKeysCommand.TryRun(["--urls", "http://localhost:5000"], output);

        Assert.False(ran);
        Assert.Empty(output.ToString());
    }

    [Fact]
    public void PushMessageTopic_SnoozeResend_SharesBaseKeyTopic()
    {
        var key = NotificationKey.ForDose(Guid.NewGuid(), DateTimeOffset.UtcNow);

        var topic = PushMessage.TopicOf(key);

        Assert.Equal(PushMessage.TopicLength, topic.Length);
        Assert.Matches("^[A-Za-z0-9_-]+$", topic);
        Assert.Equal(topic, PushMessage.TopicOf(key.Snoozed(1)));
    }
}

using Lotties.Domain.Events;

namespace Lotties.Domain.Tests.Events;

public sealed class CryDetectionTests
{
    [Theory]
    [InlineData("""{"auto_detected":true}""", true, null, true)]
    [InlineData("""{"auto_detected":true,"cry_confirmed":true}""", true, true, true)]
    [InlineData("""{"auto_detected":true,"cry_confirmed":false}""", true, false, false)]
    [InlineData("""{"auto_detected":false,"cry_confirmed":true}""", false, true, false)]
    [InlineData("""{"intensity":"mild"}""", false, null, false)]
    [InlineData("""{}""", false, null, false)]
    public void Read_TheMonitorMarks(string json, bool autoDetected, bool? confirmed, bool open)
    {
        var detection = CryDetection.Read(EventPayload.From(json));

        Assert.Equal((autoDetected, confirmed, open), (detection.AutoDetected, detection.Confirmed, detection.IsOpenDetection));
    }

    [Theory]
    [InlineData("""{"auto_detected":true,"cry_confirmed":false}""", true)]
    [InlineData("""{"cry_confirmed":false}""", true)]
    [InlineData("""{"auto_detected":true,"cry_confirmed":true}""", false)]
    [InlineData("""{"auto_detected":true}""", false)]
    [InlineData("""{"intensity":"mild"}""", false)]
    [InlineData("""[]""", false)]
    public void IsConfirmedNotCrying_OnlyTheParentsNotCryingAnswer(string json, bool notCrying)
    {
        var payload = EventPayload.Rehydrate(json);

        Assert.Equal(notCrying, CryDetection.IsConfirmedNotCrying(payload));
        Assert.Equal(!notCrying, CryDetection.Read(payload).CountsAsCrying);
    }

    [Theory]
    [InlineData("""{"cry_confirmed":"no"}""")]
    [InlineData("""{"cry_confirmed":0}""")]
    [InlineData("""{"cry_confirmed":null}""")]
    public void IsConfirmedNotCrying_AnAnswerThatIsNotABoolean_StillCounts(string json)
    {
        Assert.False(CryDetection.IsConfirmedNotCrying(EventPayload.Rehydrate(json)));
    }

    [Theory]
    [InlineData("""{"auto_detected":"true","cry_confirmed":"no"}""")]
    [InlineData("""{"auto_detected":1,"cry_confirmed":0}""")]
    [InlineData("""{"auto_detected":null,"cry_confirmed":null}""")]
    public void Read_ValuesThatAreNotBooleans_ReadAsNoValue(string json)
    {
        Assert.Equal(CryDetection.None, CryDetection.Read(EventPayload.Rehydrate(json)));
    }
}

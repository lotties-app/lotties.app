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
    [InlineData("""{"auto_detected":"true","cry_confirmed":"no"}""")]
    [InlineData("""{"auto_detected":1,"cry_confirmed":0}""")]
    [InlineData("""{"auto_detected":null,"cry_confirmed":null}""")]
    public void Read_ValuesThatAreNotBooleans_ReadAsNoValue(string json)
    {
        Assert.Equal(CryDetection.None, CryDetection.Read(EventPayload.Rehydrate(json)));
    }
}

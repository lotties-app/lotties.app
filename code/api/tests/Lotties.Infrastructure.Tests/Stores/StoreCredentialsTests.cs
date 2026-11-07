using System.Text;
using Lotties.Application.Stores;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores;
using static Lotties.Infrastructure.Tests.Stores.StoreTestKit;

namespace Lotties.Infrastructure.Tests.Stores;

public sealed class StoreCredentialsTests
{
    /// <summary>
    /// Computed independently (Python <c>cryptography</c> AESGCM) from KEK 00..1f with id <c>k1</c>, data key 20..3f, payload
    /// nonce 40..4b, wrap nonce 50..5b, store 11111111-2222-3333-4444-555555555555, owner aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
    /// and <see cref="ExpectedPayloadJson"/>. A change here is a change of the stored format: it needs a new version byte.
    /// </summary>
    private const string KnownAnswerHex =
        "4c534401026b313c505152535455565758595a5bb2061457c0759fc1749f174ee1ccadfad31ecfd81644ac151cb0dae0cc7dab4bde413c40deb66b99e4fb425beb60085d"
        + "404142434445464748494a4b068007ff3cd21a40b926b190b5bbfbcab976cba36a47e92922403f5eec2e34005fefffe699629dfc2b86f56d1086aa20e6317e6e46fe9b5d6fff"
        + "52f7e9f289cdbafac755c58bbd8d1281e71443d6203319c2d8e767571e38df2862161ca002067c25418fc6d6daa9635747fd49341d13b23039b04988faed8dff9132237f2d24"
        + "a3379a3ff3ae5998f2a2e4c75fbf0cd0db35fb4f9af74b67608e1462dace0570387023b4e2657276e1bf80864884e496399b6f1858cb83e553eb77df637b5beead3349dfdc46"
        + "39a2cc8c5dd88bdece3b80cf0957b53eec4e1494a134854531d6a9815557f39c0e42d3527107341cf9af77db0a28f5f46620abb5c3399518cf417e9175fab7a41457826f1646"
        + "efe1243cfa360667a0ff93e9d6e82506033d2b5fab5674399bc01f5f14749a1c0fd1f5ed900851da9c85eeda6d2e962bfd8d2ba6e948a840e78b75c1ffc86b06e0";

    private const string ExpectedPayloadJson =
        "{\"v\":1,\"providerLabel\":\"Example\",\"app\":{\"host\":\"db.example.test\",\"port\":5432,\"database\":\"familydb\",\"username\":\"lotties_app\",\"password\":\"app-secret-1\"},"
        + "\"migrator\":{\"host\":\"direct.example.test\",\"port\":5432,\"username\":\"lotties_migrator\",\"password\":\"mig-secret-2\"},"
        + "\"tls\":{\"sslMode\":\"verify-full\",\"caCertificatePem\":null}}";

    /// <summary>Offsets in a version 1 blob with key id <c>k1</c>: magic 0-2, version 3, id length 4, id 5-6, wrapped length 7, wrapped key 8-67, nonce 68-79, tag 80-95, ciphertext 96+.</summary>
    private const int KeyIdOffset = 5;
    private const int WrappedKeyOffset = 8;
    private const int NonceOffset = 68;
    private const int TagOffset = 80;
    private const int CiphertextOffset = 96;

    private static readonly (string Id, string Key) K1 = ("k1", Key(0x00));
    private static readonly (string Id, string Key) K2 = ("k2", Key(0x80));

    [Fact]
    public void Serialize_Descriptor_WritesThePinnedPayload()
    {
        var json = Encoding.UTF8.GetString(StoreDescriptorPayload.Serialize(Descriptor()));

        Assert.Equal(ExpectedPayloadJson, json);
    }

    [Fact]
    public void Seal_FixedKeysAndNonces_MatchesTheKnownAnswer()
    {
        var wrapper = new ConfiguredKeyWrapper(Microsoft.Extensions.Options.Options.Create(Options("k1", K1)), Scripted(Sequence(0x50, 12)));
        var credentials = new StoreCredentials(wrapper, new CapturingLogger<StoreCredentials>(), Scripted(Sequence(0x20, 32), Sequence(0x40, 12)));

        var sealedDescriptor = credentials.Seal(Descriptor(), Context);

        Assert.Equal(KnownAnswerHex, Convert.ToHexStringLower(sealedDescriptor.AsSpan()));
    }

    [Fact]
    public void Open_KnownAnswer_ReturnsTheDescriptor()
    {
        var credentials = Credentials(Wrapper("k1", K1));

        var descriptor = credentials.Open(SealedDescriptor.FromBytes(Convert.FromHexString(KnownAnswerHex)), Context);

        Assert.Equal(Descriptor(), descriptor);
    }

    [Fact]
    public void SealThenOpen_WithCaCertificate_RoundTrips()
    {
        const string pem = "-----BEGIN CERTIFICATE-----\nAQIDBA==\n-----END CERTIFICATE-----";
        var credentials = Credentials(Wrapper("k1", K1));

        var opened = credentials.Open(credentials.Seal(Descriptor(pem), Context), Context);

        Assert.Equal(Descriptor(pem), opened);
        Assert.Equal(pem, opened.Tls.CaCertificatePem);
    }

    [Fact]
    public void Open_AnySingleBitFlipped_Fails()
    {
        var credentials = Credentials(Wrapper("k1", K1));
        var original = credentials.Seal(Descriptor(), Context).ToArray();

        for (var index = 0; index < original.Length; index++)
        {
            var tampered = FlipBit(original, index, bit: index % 8);
            Assert.Throws<StoreCredentialsUnreadableException>(() => credentials.Open(SealedDescriptor.FromBytes(tampered), Context));
        }
    }

    [Theory]
    [InlineData(0, StoreCredentialsFailure.Malformed)]
    [InlineData(3, StoreCredentialsFailure.UnsupportedVersion)]
    [InlineData(4, StoreCredentialsFailure.Malformed)]
    [InlineData(WrappedKeyOffset, StoreCredentialsFailure.AuthenticationFailed)]
    [InlineData(WrappedKeyOffset + 30, StoreCredentialsFailure.AuthenticationFailed)]
    [InlineData(NonceOffset, StoreCredentialsFailure.AuthenticationFailed)]
    [InlineData(TagOffset, StoreCredentialsFailure.AuthenticationFailed)]
    [InlineData(CiphertextOffset, StoreCredentialsFailure.AuthenticationFailed)]
    public void Open_TamperedRegion_FailsWithItsClass(int index, StoreCredentialsFailure expected)
    {
        var credentials = Credentials(Wrapper("k1", K1));
        var tampered = FlipBit(credentials.Seal(Descriptor(), Context).ToArray(), index, bit: 0);

        var exception = Assert.Throws<StoreCredentialsUnreadableException>(() => credentials.Open(SealedDescriptor.FromBytes(tampered), Context));

        Assert.Equal(expected, exception.Failure);
    }

    [Fact]
    public void Open_KeyIdChangedToAnUnknownKey_FailsAsUnknownKey()
    {
        var credentials = Credentials(Wrapper("k1", K1));
        var tampered = credentials.Seal(Descriptor(), Context).ToArray();
        tampered[KeyIdOffset + 1] = (byte)'9';

        var exception = Assert.Throws<StoreCredentialsUnreadableException>(() => credentials.Open(SealedDescriptor.FromBytes(tampered), Context));

        Assert.Equal(StoreCredentialsFailure.UnknownKey, exception.Failure);
    }

    [Fact]
    public void Open_KeyIdChangedToAnotherConfiguredKey_FailsToAuthenticate()
    {
        var sealedWithK1 = Credentials(Wrapper("k1", K1, K2)).Seal(Descriptor(), Context).ToArray();
        sealedWithK1[KeyIdOffset + 1] = (byte)'2';

        var exception = Assert.Throws<StoreCredentialsUnreadableException>(() => Credentials(Wrapper("k1", K1, K2)).Open(SealedDescriptor.FromBytes(sealedWithK1), Context));

        Assert.Equal(StoreCredentialsFailure.AuthenticationFailed, exception.Failure);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(20)]
    [InlineData(CiphertextOffset)]
    public void Open_Truncated_FailsAsMalformed(int length)
    {
        var credentials = Credentials(Wrapper("k1", K1));
        var truncated = SealedDescriptor.FromBytes(credentials.Seal(Descriptor(), Context).AsSpan()[..length]);

        var exception = Assert.Throws<StoreCredentialsUnreadableException>(() => credentials.Open(truncated, Context));

        Assert.Equal(StoreCredentialsFailure.Malformed, exception.Failure);
    }

    [Fact]
    public void Open_OtherStore_Fails()
    {
        var credentials = Credentials(Wrapper("k1", K1));
        var sealedDescriptor = credentials.Seal(Descriptor(), Context);

        var exception = Assert.Throws<StoreCredentialsUnreadableException>(() => credentials.Open(sealedDescriptor, new StoreSealContext(Guid.NewGuid(), Context.OwnerId)));

        Assert.Equal(StoreCredentialsFailure.AuthenticationFailed, exception.Failure);
    }

    [Fact]
    public void Open_OtherOwner_Fails()
    {
        var credentials = Credentials(Wrapper("k1", K1));
        var sealedDescriptor = credentials.Seal(Descriptor(), Context);

        var exception = Assert.Throws<StoreCredentialsUnreadableException>(() => credentials.Open(sealedDescriptor, new StoreSealContext(Context.StoreId, Guid.NewGuid())));

        Assert.Equal(StoreCredentialsFailure.AuthenticationFailed, exception.Failure);
    }

    [Fact]
    public void Open_SameKeyIdButAnotherKey_Fails()
    {
        var sealedDescriptor = Credentials(Wrapper("k1", K1)).Seal(Descriptor(), Context);

        var exception = Assert.Throws<StoreCredentialsUnreadableException>(() => Credentials(Wrapper("k1", ("k1", RandomKey()))).Open(sealedDescriptor, Context));

        Assert.Equal(StoreCredentialsFailure.AuthenticationFailed, exception.Failure);
    }

    [Fact]
    public void Open_PayloadThatIsNotADescriptor_FailsAsInvalidDescriptor()
    {
        var wrapper = Wrapper("k1", K1);
        var forged = SealRaw(wrapper, "{\"v\":1,\"providerLabel\":\"Example\"}"u8.ToArray());

        var exception = Assert.Throws<StoreCredentialsUnreadableException>(() => Credentials(wrapper).Open(forged, Context));

        Assert.Equal(StoreCredentialsFailure.InvalidDescriptor, exception.Failure);
    }

    [Fact]
    public void Rotation_SealWithK1_OpensAfterK2BecomesCurrentAndAfterK1IsRemoved()
    {
        var sealedWithK1 = Credentials(Wrapper("k1", K1)).Seal(Descriptor(), Context);
        var duringRotation = Credentials(Wrapper("k2", K1, K2));

        Assert.Equal(Descriptor(), duringRotation.Open(sealedWithK1, Context));
        Assert.False(duringRotation.IsWrappedWithCurrentKey(sealedWithK1));

        var rewrapped = duringRotation.Rewrap(sealedWithK1, Context);
        Assert.True(duringRotation.IsWrappedWithCurrentKey(rewrapped));
        Assert.Equal("k2", SealedDescriptorEnvelope.Parse(rewrapped.AsSpan()).KeyId);

        var afterRotation = Credentials(Wrapper("k2", K2));
        Assert.Equal(Descriptor(), afterRotation.Open(rewrapped, Context));
        Assert.Equal(StoreCredentialsFailure.UnknownKey, Assert.Throws<StoreCredentialsUnreadableException>(() => afterRotation.Open(sealedWithK1, Context)).Failure);
    }

    [Fact]
    public void Rewrap_KeepsTheEncryptedDescriptor()
    {
        var sealedWithK1 = SealedDescriptorEnvelope.Parse(Credentials(Wrapper("k1", K1)).Seal(Descriptor(), Context).ToArray());

        var rewrapped = SealedDescriptorEnvelope.Parse(Credentials(Wrapper("k2", K1, K2)).Rewrap(SealedDescriptor.FromBytes(sealedWithK1.ToBytes()), Context).AsSpan());

        Assert.Equal(sealedWithK1.Nonce, rewrapped.Nonce);
        Assert.Equal(sealedWithK1.Tag, rewrapped.Tag);
        Assert.Equal(sealedWithK1.Ciphertext, rewrapped.Ciphertext);
        Assert.NotEqual(sealedWithK1.WrappedKey, rewrapped.WrappedKey);
    }

    [Fact]
    public void Rewrap_TamperedCiphertext_FailsAndDoesNotRewrap()
    {
        var tampered = FlipBit(Credentials(Wrapper("k1", K1)).Seal(Descriptor(), Context).ToArray(), CiphertextOffset + 3, bit: 2);

        var exception = Assert.Throws<StoreCredentialsUnreadableException>(() => Credentials(Wrapper("k2", K1, K2)).Rewrap(SealedDescriptor.FromBytes(tampered), Context));

        Assert.Equal(StoreCredentialsFailure.AuthenticationFailed, exception.Failure);
    }

    [Fact]
    public void Rewrap_OtherStore_Fails()
    {
        var sealedWithK1 = Credentials(Wrapper("k1", K1)).Seal(Descriptor(), Context);

        Assert.Throws<StoreCredentialsUnreadableException>(() => Credentials(Wrapper("k2", K1, K2)).Rewrap(sealedWithK1, new StoreSealContext(Guid.NewGuid(), Context.OwnerId)));
    }

    [Fact]
    public void IsWrappedWithCurrentKey_Garbage_IsFalse()
    {
        Assert.False(Credentials(Wrapper("k1", K1)).IsWrappedWithCurrentKey(SealedDescriptor.FromBytes([1, 2, 3])));
    }

    [Fact]
    public void Seal_ManyTimes_NeverRepeatsANonceOrADataKeyWrap()
    {
        var credentials = Credentials(Wrapper("k1", K1));
        var descriptor = Descriptor();

        var envelopes = Enumerable.Range(0, 5000)
            .Select(_ => SealedDescriptorEnvelope.Parse(credentials.Seal(descriptor, Context).AsSpan()))
            .ToArray();

        Assert.Equal(envelopes.Length, envelopes.Select(envelope => Convert.ToHexString(envelope.Nonce)).Distinct().Count());
        Assert.Equal(envelopes.Length, envelopes.Select(envelope => Convert.ToHexString(envelope.WrappedKey.AsSpan(0, ConfiguredKeyWrapper.NonceSize))).Distinct().Count());
        Assert.Equal(envelopes.Length, envelopes.Select(envelope => Convert.ToHexString(envelope.Ciphertext)).Distinct().Count());
    }

    [Fact]
    public void Seal_SameDescriptorTwice_GivesDifferentBlobs()
    {
        var credentials = Credentials(Wrapper("k1", K1));

        Assert.NotEqual(credentials.Seal(Descriptor(), Context), credentials.Seal(Descriptor(), Context));
    }

    [Fact]
    public void Seal_Blob_DoesNotContainThePlaintext()
    {
        var blob = Encoding.Latin1.GetString(Credentials(Wrapper("k1", K1)).Seal(Descriptor(), Context).AsSpan());

        Assert.All(Secrets, secret => Assert.DoesNotContain(secret, blob));
    }

    [Fact]
    public void StoreSealContext_EmptyIds_Throw()
    {
        Assert.Throws<ArgumentException>(() => new StoreSealContext(Guid.Empty, Guid.NewGuid()));
        Assert.Throws<ArgumentException>(() => new StoreSealContext(Guid.NewGuid(), Guid.Empty));
    }

    internal static SealedDescriptor SealRaw(ConfiguredKeyWrapper wrapper, byte[] plaintext)
    {
        var dataKey = System.Security.Cryptography.RandomNumberGenerator.GetBytes(SealedDescriptorEnvelope.DataKeySize);
        var nonce = System.Security.Cryptography.RandomNumberGenerator.GetBytes(SealedDescriptorEnvelope.NonceSize);
        var tag = new byte[SealedDescriptorEnvelope.TagSize];
        var ciphertext = new byte[plaintext.Length];
        using (var aes = new System.Security.Cryptography.AesGcm(dataKey, SealedDescriptorEnvelope.TagSize))
        {
            aes.Encrypt(nonce, plaintext, ciphertext, tag, SealedDescriptorEnvelope.AssociatedData(Context, SealedDescriptorEnvelope.PayloadPurpose));
        }

        var wrapped = wrapper.Wrap(dataKey, SealedDescriptorEnvelope.AssociatedData(Context, SealedDescriptorEnvelope.KeyWrapPurpose));
        return SealedDescriptor.FromBytes(new SealedDescriptorEnvelope(wrapped.KeyId, wrapped.Ciphertext.ToArray(), nonce, tag, ciphertext).ToBytes());
    }

    private static byte[] FlipBit(byte[] original, int index, int bit)
    {
        var copy = (byte[])original.Clone();
        copy[index] ^= (byte)(1 << bit);
        return copy;
    }
}

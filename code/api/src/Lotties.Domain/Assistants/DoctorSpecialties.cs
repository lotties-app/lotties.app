using System.Globalization;
using System.Text;

namespace Lotties.Domain.Assistants;

/// <summary>A specialty an assistant may say: its stable code and how it is spoken in each language.</summary>
/// <param name="Code">The stable lower-case code (<c>pediatrician</c>); the only form that leaves the Application.</param>
/// <param name="English">With its article, ready after "with": <c>a pediatrician</c>.</param>
/// <param name="Portuguese">Without article, ready after "com": <c>pediatra</c>.</param>
/// <param name="Synonyms">Typed variants that mean this specialty (compared without case, accents or punctuation).</param>
public sealed record DoctorSpecialty(string Code, string English, string Portuguese, IReadOnlyList<string> Synonyms);

/// <summary>
/// The only thing an assistant says about a doctor (docs/design/32-assistants.md "what an assistant may say"): the specialty, and only
/// when the free text the family typed for a care provider's specialty is exactly one of the known names below. Anything else (a
/// name, a clinic, a sentence, an unknown specialty) is never said. Pure: the Application resolves the appointment's care provider
/// and puts only the <see cref="DoctorSpecialty.Code"/> in the result.
/// </summary>
public static class DoctorSpecialties
{
    public static IReadOnlyList<DoctorSpecialty> All { get; } =
    [
        new("pediatrician", "a pediatrician", "pediatra", ["pediatra", "pediatria", "pediatrician", "paediatrician", "pediatrics", "paediatrics", "pediatric", "pediatrico", "pediatrica", "medico pediatra", "doctor pediatra", "pediatra geral"]),
        new("neonatologist", "a neonatologist", "neonatologista", ["neonatologista", "neonatologia", "neonatologist", "neonatology", "neo"]),
        new("neurologist", "a neurologist", "neurologista", ["neurologista", "neurologia", "neurologist", "neurology", "neuro"]),
        new("neuropediatrician", "a pediatric neurologist", "neuropediatra", ["neuropediatra", "neuropediatria", "neuropediatrician", "pediatric neurologist", "pediatric neurology", "neurologista pediatrico", "neurologista infantil", "neuro pediatra"]),
        new("cardiologist", "a cardiologist", "cardiologista", ["cardiologista", "cardiologia", "cardiologist", "cardiology", "cardio", "cardiopediatra"]),
        new("dermatologist", "a dermatologist", "dermatologista", ["dermatologista", "dermatologia", "dermatologist", "dermatology", "dermato", "derma"]),
        new("ophthalmologist", "an ophthalmologist", "oftalmologista", ["oftalmologista", "oftalmologia", "oftalmo", "ophthalmologist", "ophthalmology", "eye doctor", "oculista"]),
        new("otolaryngologist", "an ENT specialist", "otorrinolaringologista", ["otorrino", "otorrinolaringologista", "otorrinolaringologia", "otorhinolaryngologist", "otolaryngologist", "otolaryngology", "ent", "ent specialist", "ear nose and throat", "ear nose throat"]),
        new("orthopedist", "an orthopedist", "ortopedista", ["ortopedista", "ortopedia", "ortopedista pediatrico", "orthopedist", "orthopaedist", "orthopedics", "orthopedic", "orthopaedics", "ortho"]),
        new("gastroenterologist", "a gastroenterologist", "gastroenterologista", ["gastroenterologista", "gastroenterologia", "gastro", "gastroenterologist", "gastroenterology", "gastropediatra"]),
        new("allergist_immunologist", "an allergist", "alergista", ["alergista", "alergologista", "alergologia", "alergia", "imunologista", "imunologia", "alergista imunologista", "alergologista imunologista", "allergist", "allergy", "immunologist", "immunology", "allergist immunologist", "allergy and immunology"]),
        new("pulmonologist", "a pulmonologist", "pneumologista", ["pneumologista", "pneumologia", "pneumo", "pneumopediatra", "pulmonologista", "pulmonologist", "pulmonology", "lung doctor"]),
        new("endocrinologist", "an endocrinologist", "endocrinologista", ["endocrinologista", "endocrinologia", "endocrino", "endocrinologist", "endocrinology", "endocrine", "endocrinopediatra"]),
        new("nutritionist", "a nutritionist", "nutricionista", ["nutricionista", "nutricao", "nutritionist", "nutrition", "dietitian", "dietician", "nutrologo", "nutrologa"]),
        new("speech_therapist", "a speech therapist", "fonoaudiólogo", ["fonoaudiologo", "fonoaudiologa", "fonoaudiologia", "fono", "speech therapist", "speech therapy", "speech language pathologist", "slp"]),
        new("physiotherapist", "a physiotherapist", "fisioterapeuta", ["fisioterapeuta", "fisioterapia", "fisio", "physiotherapist", "physiotherapy", "physical therapist", "physical therapy"]),
        new("psychologist", "a psychologist", "psicólogo", ["psicologo", "psicologa", "psicologia", "psychologist", "psychology", "psico"]),
        new("dentist", "a dentist", "dentista", ["dentista", "odontopediatra", "odontologia", "odontologista", "dentist", "dentistry", "pediatric dentist", "dental"]),
        new("general_practitioner", "a general practitioner", "clínico geral", ["clinico geral", "clinica geral", "medico de familia", "medicina de familia", "medicina geral", "general practitioner", "gp", "family doctor", "family physician", "family medicine", "general practice"]),
    ];

    private static readonly Dictionary<string, DoctorSpecialty> ByText = All
        .SelectMany(specialty => specialty.Synonyms.Append(specialty.Code).Append(specialty.English).Append(specialty.Portuguese).Select(text => (Key: Normalize(text), specialty)))
        .GroupBy(entry => entry.Key)
        .ToDictionary(group => group.Key, group => group.First().specialty);

    /// <summary>The specialty code of typed text that names one of the known specialties, else <c>null</c> (never the text).</summary>
    public static string? CodeOf(string? typed) =>
        typed is { Length: > 0 and <= 80 } && ByText.TryGetValue(Normalize(typed), out var specialty) ? specialty.Code : null;

    /// <summary>The specialty of a code <see cref="CodeOf"/> returned, else <c>null</c>.</summary>
    public static DoctorSpecialty? Find(string? code) => code is null ? null : All.FirstOrDefault(specialty => specialty.Code == code);

    /// <summary>Lower case, no accents, letters and digits only, single spaces.</summary>
    private static string Normalize(string text)
    {
        var builder = new StringBuilder();
        foreach (var character in text.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            builder.Append(char.IsLetterOrDigit(character) ? character : ' ');
        }

        return string.Join(' ', builder.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}

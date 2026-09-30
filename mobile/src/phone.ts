import { t, countryName } from './i18n';
import countries from './data/countries.json';
import rules from './data/phone-rules.json';
export function phoneRule(region: string) {
  return (rules as Record<string, { lengths: number[]; pattern: string; prefix: string }>)[region];
}
export function phoneError(value: string, region?: string): string {
  const candidates = region
    ? countries.filter((c) => c.code === countries.find((item) => item.region === region)?.code)
    : countries.filter((c) => value.startsWith(c.code));
  if (!candidates.length) return t('Choose a country code and enter your mobile number.');
  const longest = Math.max(...candidates.map((c) => c.code.length));
  const matching = candidates.filter((c) => c.code.length === longest);
  if (
    matching.some((c) => {
      const national = value.slice(c.code.length);
      const rule = phoneRule(c.region);
      return (
        rule &&
        rule.lengths.includes(national.length) &&
        new RegExp(`^(?:${rule.pattern})$`).test(national)
      );
    })
  )
    return '';
  const country = matching[0];
  const lengths = phoneRule(country.region)?.lengths || [];
  const national = value.slice(country.code.length);
  if (!lengths.includes(national.length))
    return t('Enter {0} digits for {1}, without the country code.', [
      lengths.join(t(' or ')),
      countryName(country.region, country.name),
    ]);
  return t('Enter a valid mobile number for {0}.', [countryName(country.region, country.name)]);
}

/**
 * A row from one of the localised vocabularies — genders, conditions, the
 * medication library (migration 014).
 *
 * `name` is the server's own resolution for the requesting locale and is what
 * older screens read; the pair beneath it is what lets a screen re-resolve when
 * the user switches language without refetching. Both are optional because a
 * client can be newer than the Lambda: resolve through `localisedName` rather
 * than reading any of these three directly.
 */
export interface GeneralOption {
    id: number;
    name?: string;
    name_en?: string | null;
    name_zh_hant?: string | null;
}

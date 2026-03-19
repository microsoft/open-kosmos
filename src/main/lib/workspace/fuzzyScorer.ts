/**
 * Fuzzy Scorer - Migrated from VSCode
 * Provides high-quality fuzzy matching and scoring algorithms
 * 
 * Based on VSCode's fuzzyScorer.ts implementation
 * File: vscode/src/vs/base/common/fuzzyScorer.ts
 */

import * as path from 'path';

//#region Types

export type FuzzyScore = [number /* score */, number[] /* match positions */];
export type FuzzyScorerCache = { [key: string]: IItemScore };

export interface IMatch {
  start: number;
  end: number;
}

export interface IItemScore {
  /**
   * Overall score.
   */
  score: number;

  /**
   * Matches within the label.
   */
  labelMatch?: IMatch[];

  /**
   * Matches within the description.
   */
  descriptionMatch?: IMatch[];
}

export interface IItemAccessor<T> {
  /**
   * Just the label of the item to score on.
   */
  getItemLabel(item: T): string | undefined;

  /**
   * The optional description of the item to score on.
   */
  getItemDescription(item: T): string | undefined;

  /**
   * If the item is a file, the path of the file to score on.
   */
  getItemPath(file: T): string | undefined;
}

export interface IPreparedQueryPiece {
  /**
   * The original query as provided as input.
   */
  original: string;
  originalLowercase: string;

  /**
   * In addition to the normalized path, will have
   * whitespace and wildcards removed.
   */
  normalized: string;
  normalizedLowercase: string;

  /**
   * The query is wrapped in quotes which means
   * this query must be a substring of the input.
   */
  expectContiguousMatch: boolean;
}

export interface IPreparedQuery extends IPreparedQueryPiece {
  /**
   * Query split by spaces into pieces.
   */
  values: IPreparedQueryPiece[] | undefined;

  /**
   * Whether the query contains path separator(s) or not.
   */
  containsPathSeparator: boolean;
}

//#endregion

//#region Constants

const NO_MATCH = 0;
const NO_SCORE: FuzzyScore = [NO_MATCH, []];
const NO_ITEM_SCORE = Object.freeze<IItemScore>({ score: 0 });

const PATH_IDENTITY_SCORE = 1 << 18;           // 262,144
const LABEL_PREFIX_SCORE_THRESHOLD = 1 << 17;  // 131,072
const LABEL_SCORE_THRESHOLD = 1 << 16;         // 65,536

// Character codes
const CharCode_Slash = 47;        // /
const CharCode_Backslash = 92;    // \
const CharCode_Underline = 95;    // _
const CharCode_Dash = 45;         // -
const CharCode_Period = 46;       // .
const CharCode_Space = 32;        //  
const CharCode_SingleQuote = 39;  // '
const CharCode_DoubleQuote = 34;  // "
const CharCode_Colon = 58;        // :
const CharCode_A = 65;
const CharCode_Z = 90;

//#endregion

//#region Helper Functions

function isUpper(code: number): boolean {
  return code >= CharCode_A && code <= CharCode_Z;
}

function considerAsEqual(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }

  // Special case path separators: ignore platform differences
  if (a === '/' || a === '\\') {
    return b === '/' || b === '\\';
  }

  return false;
}

function scoreSeparatorAtPos(charCode: number): number {
  switch (charCode) {
    case CharCode_Slash:
    case CharCode_Backslash:
      return 5; // prefer path separators...
    case CharCode_Underline:
    case CharCode_Dash:
    case CharCode_Period:
    case CharCode_Space:
    case CharCode_SingleQuote:
    case CharCode_DoubleQuote:
    case CharCode_Colon:
      return 4; // ...over other separators
    default:
      return 0;
  }
}

function stripWildcards(pattern: string): string {
  return pattern.replace(/\*/g, '');
}

function matchesPrefix(query: string, target: string): IMatch[] | undefined {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();
  
  if (targetLower.startsWith(queryLower)) {
    return [{ start: 0, end: query.length }];
  }
  
  return undefined;
}

//#endregion

//#region Core Fuzzy Scoring Algorithm

/**
 * Compute character-level fuzzy score
 */
function computeCharScore(
  queryCharAtIndex: string,
  queryLowerCharAtIndex: string,
  target: string,
  targetLower: string,
  targetIndex: number,
  matchesSequenceLength: number
): number {
  let score = 0;

  if (!considerAsEqual(queryLowerCharAtIndex, targetLower[targetIndex])) {
    return score; // no match of characters
  }

  // Character match bonus
  score += 1;

  // Consecutive match bonus: sequences up to 3 get the full bonus (6)
  // and the remainder gets half the bonus (3).
  if (matchesSequenceLength > 0) {
    score += (Math.min(matchesSequenceLength, 3) * 6) + (Math.max(0, matchesSequenceLength - 3) * 3);
  }

  // Same case bonus
  if (queryCharAtIndex === target[targetIndex]) {
    score += 1;
  }

  // Start of word bonus
  if (targetIndex === 0) {
    score += 8;
  } else {
    // After separator bonus
    const separatorBonus = scoreSeparatorAtPos(target.charCodeAt(targetIndex - 1));
    if (separatorBonus) {
      score += separatorBonus;
    }
    // Inside word upper case bonus (camel case)
    else if (isUpper(target.charCodeAt(targetIndex)) && matchesSequenceLength === 0) {
      score += 2;
    }
  }

  return score;
}

/**
 * Core fuzzy matching algorithm using dynamic programming
 */
function doScoreFuzzy(
  query: string,
  queryLower: string,
  queryLength: number,
  target: string,
  targetLower: string,
  targetLength: number,
  allowNonContiguousMatches: boolean
): FuzzyScore {
  const scores: number[] = [];
  const matches: number[] = [];

  // Build Scorer Matrix
  for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
    const queryIndexOffset = queryIndex * targetLength;
    const queryIndexPreviousOffset = queryIndexOffset - targetLength;
    const queryIndexGtNull = queryIndex > 0;
    const queryCharAtIndex = query[queryIndex];
    const queryLowerCharAtIndex = queryLower[queryIndex];

    for (let targetIndex = 0; targetIndex < targetLength; targetIndex++) {
      const targetIndexGtNull = targetIndex > 0;
      const currentIndex = queryIndexOffset + targetIndex;
      const leftIndex = currentIndex - 1;
      const diagIndex = queryIndexPreviousOffset + targetIndex - 1;

      const leftScore = targetIndexGtNull ? scores[leftIndex] : 0;
      const diagScore = queryIndexGtNull && targetIndexGtNull ? scores[diagIndex] : 0;
      const matchesSequenceLength = queryIndexGtNull && targetIndexGtNull ? matches[diagIndex] : 0;

      let score: number;
      if (!diagScore && queryIndexGtNull) {
        score = 0;
      } else {
        score = computeCharScore(
          queryCharAtIndex,
          queryLowerCharAtIndex,
          target,
          targetLower,
          targetIndex,
          matchesSequenceLength
        );
      }

      const isValidScore = score && diagScore + score >= leftScore;
      if (isValidScore && (
        allowNonContiguousMatches ||
        queryIndexGtNull ||
        targetLower.startsWith(queryLower, targetIndex)
      )) {
        matches[currentIndex] = matchesSequenceLength + 1;
        scores[currentIndex] = diagScore + score;
      } else {
        matches[currentIndex] = NO_MATCH;
        scores[currentIndex] = leftScore;
      }
    }
  }

  // Restore positions
  const positions: number[] = [];
  let queryIndex = queryLength - 1;
  let targetIndex = targetLength - 1;
  while (queryIndex >= 0 && targetIndex >= 0) {
    const currentIndex = queryIndex * targetLength + targetIndex;
    const match = matches[currentIndex];
    if (match === NO_MATCH) {
      targetIndex--;
    } else {
      positions.push(targetIndex);
      queryIndex--;
      targetIndex--;
    }
  }

  return [scores[queryLength * targetLength - 1], positions.reverse()];
}

export function scoreFuzzy(
  target: string,
  query: string,
  queryLower: string,
  allowNonContiguousMatches: boolean
): FuzzyScore {
  if (!target || !query) {
    return NO_SCORE;
  }

  const targetLength = target.length;
  const queryLength = query.length;

  if (targetLength < queryLength) {
    return NO_SCORE;
  }

  const targetLower = target.toLowerCase();
  return doScoreFuzzy(query, queryLower, queryLength, target, targetLower, targetLength, allowNonContiguousMatches);
}

//#endregion

//#region Item Scoring

function createMatches(offsets: number[] | undefined): IMatch[] {
  const ret: IMatch[] = [];
  if (!offsets) {
    return ret;
  }

  let last: IMatch | undefined;
  for (const pos of offsets) {
    if (last && last.end === pos) {
      last.end += 1;
    } else {
      last = { start: pos, end: pos + 1 };
      ret.push(last);
    }
  }

  return ret;
}

function doScoreItemFuzzy(
  label: string,
  description: string | undefined,
  pathValue: string | undefined,
  query: IPreparedQuery,
  allowNonContiguousMatches: boolean
): IItemScore {
  const preferLabelMatches = !pathValue || !query.containsPathSeparator;

  // Treat identity matches on full path highest
  if (pathValue && query.normalized === pathValue) {
    return {
      score: PATH_IDENTITY_SCORE,
      labelMatch: [{ start: 0, end: label.length }],
      descriptionMatch: description ? [{ start: 0, end: description.length }] : undefined
    };
  }

  // Score: single input
  if (!query.values || query.values.length === 1) {
    return doScoreItemFuzzySingle(label, description, pathValue, query, preferLabelMatches, allowNonContiguousMatches);
  }

  // Score: multiple inputs
  return doScoreItemFuzzyMultiple(label, description, pathValue, query.values, preferLabelMatches, allowNonContiguousMatches);
}

function doScoreItemFuzzySingle(
  label: string,
  description: string | undefined,
  pathValue: string | undefined,
  query: IPreparedQueryPiece,
  preferLabelMatches: boolean,
  allowNonContiguousMatches: boolean
): IItemScore {
  // Prefer label matches if told so or we have no description
  if (preferLabelMatches || !description) {
    const [labelScore, labelPositions] = scoreFuzzy(
      label,
      query.normalized,
      query.normalizedLowercase,
      allowNonContiguousMatches && !query.expectContiguousMatch
    );

    if (labelScore) {
      const labelPrefixMatch = matchesPrefix(query.normalized, label);
      let baseScore: number;

      if (labelPrefixMatch) {
        baseScore = LABEL_PREFIX_SCORE_THRESHOLD;
        // Boost for shorter labels
        const prefixLengthBoost = Math.round((query.normalized.length / label.length) * 100);
        baseScore += prefixLengthBoost;
      } else {
        baseScore = LABEL_SCORE_THRESHOLD;
      }

      return {
        score: baseScore + labelScore,
        labelMatch: labelPrefixMatch || createMatches(labelPositions)
      };
    }
  }

  // Finally compute description + label scores if we have a description
  if (description) {
    const descriptionAndLabel = `${description}${path.sep}${label}`;
    const descriptionPrefixLength = description.length + 1;

    const [labelDescriptionScore, labelDescriptionPositions] = scoreFuzzy(
      descriptionAndLabel,
      query.normalized,
      query.normalizedLowercase,
      allowNonContiguousMatches && !query.expectContiguousMatch
    );

    if (labelDescriptionScore) {
      const labelDescriptionMatches = createMatches(labelDescriptionPositions);
      const labelMatch: IMatch[] = [];
      const descriptionMatch: IMatch[] = [];

      // Split matches back onto label and description
      labelDescriptionMatches.forEach(h => {
        // Match overlaps label and description part
        if (h.start < descriptionPrefixLength && h.end > descriptionPrefixLength) {
          labelMatch.push({ start: 0, end: h.end - descriptionPrefixLength });
          descriptionMatch.push({ start: h.start, end: descriptionPrefixLength });
        }
        // Match on label part
        else if (h.start >= descriptionPrefixLength) {
          labelMatch.push({ start: h.start - descriptionPrefixLength, end: h.end - descriptionPrefixLength });
        }
        // Match on description part
        else {
          descriptionMatch.push(h);
        }
      });

      return { score: labelDescriptionScore, labelMatch, descriptionMatch };
    }
  }

  return NO_ITEM_SCORE;
}

function doScoreItemFuzzyMultiple(
  label: string,
  description: string | undefined,
  pathValue: string | undefined,
  query: IPreparedQueryPiece[],
  preferLabelMatches: boolean,
  allowNonContiguousMatches: boolean
): IItemScore {
  let totalScore = 0;
  const totalLabelMatches: IMatch[] = [];
  const totalDescriptionMatches: IMatch[] = [];

  for (const queryPiece of query) {
    const { score, labelMatch, descriptionMatch } = doScoreItemFuzzySingle(
      label,
      description,
      pathValue,
      queryPiece,
      preferLabelMatches,
      allowNonContiguousMatches
    );

    if (score === NO_MATCH) {
      return NO_ITEM_SCORE;
    }

    totalScore += score;
    if (labelMatch) {
      totalLabelMatches.push(...labelMatch);
    }
    if (descriptionMatch) {
      totalDescriptionMatches.push(...descriptionMatch);
    }
  }

  return {
    score: totalScore,
    labelMatch: normalizeMatches(totalLabelMatches),
    descriptionMatch: normalizeMatches(totalDescriptionMatches)
  };
}

function normalizeMatches(matches: IMatch[]): IMatch[] {
  const sortedMatches = matches.sort((matchA, matchB) => matchA.start - matchB.start);
  const normalizedMatches: IMatch[] = [];
  let currentMatch: IMatch | undefined = undefined;

  for (const match of sortedMatches) {
    if (!currentMatch || !matchOverlaps(currentMatch, match)) {
      currentMatch = match;
      normalizedMatches.push(match);
    } else {
      currentMatch.start = Math.min(currentMatch.start, match.start);
      currentMatch.end = Math.max(currentMatch.end, match.end);
    }
  }

  return normalizedMatches;
}

function matchOverlaps(matchA: IMatch, matchB: IMatch): boolean {
  if (matchA.end < matchB.start) {
    return false;
  }
  if (matchB.end < matchA.start) {
    return false;
  }
  return true;
}

export function scoreItemFuzzy<T>(
  item: T,
  query: IPreparedQuery,
  allowNonContiguousMatches: boolean,
  accessor: IItemAccessor<T>,
  cache: FuzzyScorerCache
): IItemScore {
  if (!item || !query.normalized) {
    return NO_ITEM_SCORE;
  }

  const label = accessor.getItemLabel(item);
  if (!label) {
    return NO_ITEM_SCORE;
  }

  const description = accessor.getItemDescription(item);
  const pathValue = accessor.getItemPath(item);

  // Use cache
  const cacheKey = `${label}|${description || ''}|${query.normalized}|${allowNonContiguousMatches}`;
  const cached = cache[cacheKey];
  if (cached) {
    return cached;
  }

  const itemScore = doScoreItemFuzzy(label, description, pathValue, query, allowNonContiguousMatches);
  cache[cacheKey] = itemScore;

  return itemScore;
}

//#endregion

//#region Query Preparation

function queryExpectsExactMatch(query: string): boolean {
  return query.startsWith('"') && query.endsWith('"');
}

function normalizeQuery(original: string): { normalized: string; normalizedLowercase: string } {
  // Remove quotes and wildcards
  const normalized = stripWildcards(original).replace(/\s|"/g, '');

  return {
    normalized,
    normalizedLowercase: normalized.toLowerCase()
  };
}

export function prepareQuery(original: string): IPreparedQuery {
  if (typeof original !== 'string') {
    original = '';
  }

  const originalLowercase = original.toLowerCase();
  const { normalized, normalizedLowercase } = normalizeQuery(original);
  const containsPathSeparator = normalized.indexOf(path.sep) >= 0;
  const expectExactMatch = queryExpectsExactMatch(original);

  let values: IPreparedQueryPiece[] | undefined = undefined;

  const originalSplit = original.split(' ');
  if (originalSplit.length > 1) {
    for (const originalPiece of originalSplit) {
      const expectExactMatchPiece = queryExpectsExactMatch(originalPiece);
      const { normalized: normalizedPiece, normalizedLowercase: normalizedLowercasePiece } = normalizeQuery(originalPiece);

      if (normalizedPiece) {
        if (!values) {
          values = [];
        }

        values.push({
          original: originalPiece,
          originalLowercase: originalPiece.toLowerCase(),
          normalized: normalizedPiece,
          normalizedLowercase: normalizedLowercasePiece,
          expectContiguousMatch: expectExactMatchPiece
        });
      }
    }
  }

  return {
    original,
    originalLowercase,
    normalized,
    normalizedLowercase,
    values,
    containsPathSeparator,
    expectContiguousMatch: expectExactMatch
  };
}

//#endregion

//#region Comparison

function compareByMatchLength(matchesA?: IMatch[], matchesB?: IMatch[]): number {
  if ((!matchesA && !matchesB) || ((!matchesA || !matchesA.length) && (!matchesB || !matchesB.length))) {
    return 0;
  }

  if (!matchesB || !matchesB.length) {
    return -1;
  }

  if (!matchesA || !matchesA.length) {
    return 1;
  }

  const matchStartA = matchesA[0].start;
  const matchEndA = matchesA[matchesA.length - 1].end;
  const matchLengthA = matchEndA - matchStartA;

  const matchStartB = matchesB[0].start;
  const matchEndB = matchesB[matchesB.length - 1].end;
  const matchLengthB = matchEndB - matchStartB;

  return matchLengthA === matchLengthB ? 0 : matchLengthB < matchLengthA ? 1 : -1;
}

function computeLabelAndDescriptionMatchDistance<T>(
  item: T,
  score: IItemScore,
  accessor: IItemAccessor<T>
): number {
  let matchStart: number = -1;
  let matchEnd: number = -1;

  if (score.descriptionMatch && score.descriptionMatch.length) {
    matchStart = score.descriptionMatch[0].start;
  } else if (score.labelMatch && score.labelMatch.length) {
    matchStart = score.labelMatch[0].start;
  }

  if (score.labelMatch && score.labelMatch.length) {
    matchEnd = score.labelMatch[score.labelMatch.length - 1].end;
    if (score.descriptionMatch && score.descriptionMatch.length) {
      const itemDescription = accessor.getItemDescription(item);
      if (itemDescription) {
        matchEnd += itemDescription.length;
      }
    }
  } else if (score.descriptionMatch && score.descriptionMatch.length) {
    matchEnd = score.descriptionMatch[score.descriptionMatch.length - 1].end;
  }

  return matchEnd - matchStart;
}

function fallbackCompare<T>(itemA: T, itemB: T, query: IPreparedQuery, accessor: IItemAccessor<T>): number {
  const labelA = accessor.getItemLabel(itemA) || '';
  const labelB = accessor.getItemLabel(itemB) || '';

  const descriptionA = accessor.getItemDescription(itemA);
  const descriptionB = accessor.getItemDescription(itemB);

  const labelDescriptionALength = labelA.length + (descriptionA ? descriptionA.length : 0);
  const labelDescriptionBLength = labelB.length + (descriptionB ? descriptionB.length : 0);

  if (labelDescriptionALength !== labelDescriptionBLength) {
    return labelDescriptionALength - labelDescriptionBLength;
  }

  const pathA = accessor.getItemPath(itemA);
  const pathB = accessor.getItemPath(itemB);

  if (pathA && pathB && pathA.length !== pathB.length) {
    return pathA.length - pathB.length;
  }

  if (labelA !== labelB) {
    return labelA.localeCompare(labelB);
  }

  if (descriptionA && descriptionB && descriptionA !== descriptionB) {
    return descriptionA.localeCompare(descriptionB);
  }

  if (pathA && pathB && pathA !== pathB) {
    return pathA.localeCompare(pathB);
  }

  return 0;
}

export function compareItemsByFuzzyScore<T>(
  itemA: T,
  itemB: T,
  query: IPreparedQuery,
  allowNonContiguousMatches: boolean,
  accessor: IItemAccessor<T>,
  cache: FuzzyScorerCache
): number {
  const itemScoreA = scoreItemFuzzy(itemA, query, allowNonContiguousMatches, accessor, cache);
  const itemScoreB = scoreItemFuzzy(itemB, query, allowNonContiguousMatches, accessor, cache);

  const scoreA = itemScoreA.score;
  const scoreB = itemScoreB.score;

  // 1. Identity matches have highest score
  if (scoreA === PATH_IDENTITY_SCORE || scoreB === PATH_IDENTITY_SCORE) {
    if (scoreA !== scoreB) {
      return scoreA === PATH_IDENTITY_SCORE ? -1 : 1;
    }
  }

  // 2. Matches on label are higher than label+description
  if (scoreA > LABEL_SCORE_THRESHOLD || scoreB > LABEL_SCORE_THRESHOLD) {
    if (scoreA !== scoreB) {
      return scoreA > scoreB ? -1 : 1;
    }

    // Prefer more compact matches
    if (scoreA < LABEL_PREFIX_SCORE_THRESHOLD && scoreB < LABEL_PREFIX_SCORE_THRESHOLD) {
      const comparedByMatchLength = compareByMatchLength(itemScoreA.labelMatch, itemScoreB.labelMatch);
      if (comparedByMatchLength !== 0) {
        return comparedByMatchLength;
      }
    }

    // Prefer shorter labels
    const labelA = accessor.getItemLabel(itemA) || '';
    const labelB = accessor.getItemLabel(itemB) || '';
    if (labelA.length !== labelB.length) {
      return labelA.length - labelB.length;
    }
  }

  // 3. Compare by score in label+description
  if (scoreA !== scoreB) {
    return scoreA > scoreB ? -1 : 1;
  }

  // 4. Prefer matches in label over non-label matches
  const itemAHasLabelMatches = Array.isArray(itemScoreA.labelMatch) && itemScoreA.labelMatch.length > 0;
  const itemBHasLabelMatches = Array.isArray(itemScoreB.labelMatch) && itemScoreB.labelMatch.length > 0;
  if (itemAHasLabelMatches && !itemBHasLabelMatches) {
    return -1;
  } else if (itemBHasLabelMatches && !itemAHasLabelMatches) {
    return 1;
  }

  // 5. Prefer more compact matches
  const itemAMatchDistance = computeLabelAndDescriptionMatchDistance(itemA, itemScoreA, accessor);
  const itemBMatchDistance = computeLabelAndDescriptionMatchDistance(itemB, itemScoreB, accessor);
  if (itemAMatchDistance && itemBMatchDistance && itemAMatchDistance !== itemBMatchDistance) {
    return itemBMatchDistance > itemAMatchDistance ? -1 : 1;
  }

  // 6. Fallback compare
  return fallbackCompare(itemA, itemB, query, accessor);
}

//#endregion
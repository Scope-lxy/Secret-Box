const TARGET_LENGTH = 25
const TOLERANCE_LENGTH = 30
const MAX_LENGTH = 40

const sentenceEndings = new Set(['。', '！', '？', '!', '?', '…', '.'])
const secondaryPunctuation = new Set(['，', '、', '；', '：', ',', ';', ':'])
const closingCharacters = new Set(['”', '’', '」', '』', '）', '》', '】'])
const regularSpaces = new Set([' '])

function findBoundaries(characters, start, limit, punctuation) {
  const end = Math.min(characters.length, start + limit)
  const boundaries = []
  for (let index = start; index < end; index += 1) {
    const character = characters[index]
    if (!punctuation.has(character)) continue

    let sentenceEnd = index + 1
    if (character === '…' || character === '.') {
      while (characters[sentenceEnd] === character) sentenceEnd += 1
    }
    while (closingCharacters.has(characters[sentenceEnd])) sentenceEnd += 1
    boundaries.push({ position: sentenceEnd, boundary: sentenceEnd })
    index = sentenceEnd - 1
  }
  return boundaries
}

function chooseBoundary(boundaries, start) {
  const target = start + TARGET_LENGTH
  const withinTolerance = boundaries.filter(({ position }) => position <= start + TOLERANCE_LENGTH)
  if (withinTolerance.length) {
    return withinTolerance.reduce((best, candidate) => {
      const bestDistance = Math.abs(best.position - target)
      const distance = Math.abs(candidate.position - target)
      return distance < bestDistance || (distance === bestDistance && candidate.position > best.position) ? candidate : best
    }).boundary
  }
  return boundaries[0]?.boundary || 0
}

function splitEvenly(characters, start) {
  const remaining = characters.length - start
  const segmentCount = Math.max(Math.ceil(remaining / MAX_LENGTH), Math.round(remaining / TARGET_LENGTH))
  const baseLength = Math.floor(remaining / segmentCount)
  const longerSegmentCount = remaining % segmentCount
  const paragraphs = []
  let index = start

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const length = baseLength + (segment < longerSegmentCount ? 1 : 0)
    paragraphs.push(characters.slice(index, index + length).join(''))
    index += length
  }
  return paragraphs
}

function splitContentParagraphs(value) {
  const characters = Array.from(String(value || '').trim())
  if (!characters.length) return []

  const paragraphs = []
  let start = 0

  while (start < characters.length) {
    const remaining = characters.length - start
    if (remaining <= TOLERANCE_LENGTH) break
    const sentenceBoundary = chooseBoundary(findBoundaries(characters, start, MAX_LENGTH, sentenceEndings), start)

    if (sentenceBoundary) {
      const paragraph = characters.slice(start, sentenceBoundary).join('').trim()
      if (paragraph) paragraphs.push(paragraph)
      start = sentenceBoundary
      continue
    }

    if (remaining <= MAX_LENGTH) break

    const secondaryBoundary = chooseBoundary(findBoundaries(characters, start, MAX_LENGTH, secondaryPunctuation), start)
    if (secondaryBoundary) {
      const paragraph = characters.slice(start, secondaryBoundary).join('').trim()
      if (paragraph) paragraphs.push(paragraph)
      start = secondaryBoundary
      continue
    }

    const hasPunctuation = characters.slice(start).some((character) => sentenceEndings.has(character) || secondaryPunctuation.has(character))
    const spaceBoundary = hasPunctuation
      ? 0
      : chooseBoundary(findBoundaries(characters, start, MAX_LENGTH, regularSpaces), start)
    if (spaceBoundary) {
      const paragraph = characters.slice(start, spaceBoundary).join('').trim()
      if (paragraph) paragraphs.push(paragraph)
      start = spaceBoundary
      continue
    }

    paragraphs.push(...splitEvenly(characters, start))
    start = characters.length
  }

  const remainder = characters.slice(start).join('').trim()
  if (remainder) paragraphs.push(remainder)
  return paragraphs
}

module.exports = {
  splitContentParagraphs,
}

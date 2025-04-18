import { describe, expect, test } from 'vitest'
import { builtInFormatters, createSqlTranspiler, type Result, type SqlFormatter, type SqlValue, type SqlOperator } from './generateSql'

const fields = {
  1: 'id',
  2: 'name',
  3: 'date_joined',
  4: 'age',
}

test('handles the cases from the prompt: https://gist.github.com/perivamsi/1cbea6e3874ba5638cd58202d7dcb1f7', () => {
  const { generateSql } = createSqlTranspiler()
  const cases: [Result<string, Error>, string][] = [
    [
      generateSql('postgres', fields, { 'where': ['=', ['field', 3], null] }),
      'SELECT * FROM data WHERE "date_joined" IS NULL;',
    ],
    [
      generateSql('postgres', fields, { 'where': ['>', ['field', 4], 35] }),
      'SELECT * FROM data WHERE "age" > 35;',
    ],
    [
      generateSql('postgres', fields, { 'where': ['and', ['<', ['field', 1], 5], ['=', ['field', 2], 'joe']] }),
      'SELECT * FROM data WHERE "id" < 5 AND "name" = \'joe\';',
    ],
    [
      // NOTE: The prompt doesn't have `id` wrapped in quotes, but I do. They're both valid postgres,
      // but it seemed out of scope to conditionally exclude quotes for fields like `id` but keep them for fields like `date_joined`.
      generateSql('postgres', fields, { 'where': ['or', ['!=', ['field', 3], '2015-11-01'], ['=', ['field', 1], 456]] }),
      'SELECT * FROM data WHERE "date_joined" <> \'2015-11-01\' OR "id" = 456;',
    ],
    [
      generateSql('postgres', fields, { 'where': ['and', ['!=', ['field', 3], null], ['or', ['>', ['field', 4], 25], ['=', ['field', 2], 'Jerry']]] }),
      'SELECT * FROM data WHERE "date_joined" IS NOT NULL AND ("age" > 25 OR "name" = \'Jerry\');',
    ],
    [
      generateSql('postgres', fields, { 'where': ['=', ['field', 4], 25, 26, 27] }),
      'SELECT * FROM data WHERE "age" IN (25, 26, 27);',
    ],
    [
      generateSql('postgres', fields, { 'where': ['=', ['field', 2], 'cam'] }),
      'SELECT * FROM data WHERE "name" = \'cam\';',
    ],
    [
      generateSql('mysql', fields, { 'where': ['=', ['field', 2], 'cam'], 'limit': 10 }),
      'SELECT * FROM data WHERE `name` = \'cam\' LIMIT 10;',
    ],
    [
      generateSql('postgres', fields, { 'limit': 20 }),
      'SELECT * FROM data LIMIT 20;',
    ],
    [
      generateSql('sqlserver', fields, { 'limit': 20 }),
      'SELECT TOP 20 * FROM data;',
    ],
  ]
  cases.forEach(([actual, expected]) => {
    expect(actual.success).toBe(true)
    expect(actual.data).toBe(expected)
  })
})

test('handles NOT', () => {
  const { generateSql } = createSqlTranspiler()
  const result = generateSql('postgres', fields, { 'where': ['not', ['>', ['field', 4], 35]] })
  expect(result.success).toBe(true)
  expect(result.data).toBe('SELECT * FROM data WHERE NOT ("age" > 35);')
})

test('handles invalid fields', () => {
  const { generateSql } = createSqlTranspiler()
  const result = generateSql('postgres', fields, { 'where': ['>', ['field', 999], 35] })
  expect(result.success).toBe(false)
  expect(result.error?.message).toBe('Unknown field number: 999')
})

describe('macros', () => {
  test('supports macros', () => {
    const { generateSql } = createSqlTranspiler<['macro', 'is_joe']>({
      macros: { 'is_joe': ['=', ['field', 2], 'joe'] },
    })
    const result = generateSql('postgres', fields, { where: ['and', ['<', ['field', 1], 5], ['macro', 'is_joe']] })
    expect(result.success).toBe(true)
    expect(result.data).toBe('SELECT * FROM data WHERE "id" < 5 AND "name" = \'joe\';')
  })

  test('supports nested macros', () => {
    const { generateSql } = createSqlTranspiler<['macro', 'is_joe' | 'is_adult' | 'is_adult_joe']>({
      macros: {
        'is_joe': ['=', ['field', 2], 'joe'],
        'is_adult': ['>', ['field', 4], 18],
        'is_adult_joe': ['and', ['macro', 'is_joe'], ['macro', 'is_adult']],
      },
    })
    const result = generateSql('postgres', fields, { where: ['and', ['<', ['field', 1], 5], ['macro', 'is_adult_joe']] })
    expect(result.success).toBe(true)
    expect(result.data).toBe('SELECT * FROM data WHERE "id" < 5 AND "name" = \'joe\' AND "age" > 18;')
  })

  test('handles invalid macros', () => {
    const { generateSql } = createSqlTranspiler()
    const result = generateSql('postgres', fields, { where: ['and', ['<', ['field', 1], 5], ['macro', 'is_adult_joe' as never]] })
    expect(result.success).toBe(false)
    expect(result.error?.message).toBe('Macro not found: is_adult_joe')
  })
})

test('returns an error when the where clause contains a circular dependency', () => {
  const { generateSql } = createSqlTranspiler<['macro', 'is_decent' | 'is_good']>({
    macros: {
      'is_good': ['and', ['macro', 'is_decent'], ['>', ['field', 4], 18]],
      'is_decent': ['and', ['macro', 'is_good'], ['<', ['field', 5], 5]],
    },
  })
  let result: Result<string, Error>
  result = generateSql('postgres', fields, { where: ['macro', 'is_decent'] })
  expect(result.success).toBe(false)
  expect(result.error?.message).toBe('Circular dependency detected')

  const reusedWhereClause: SqlOperator<never> = ['field', 1]
  result = generateSql('postgres', fields, { where: ['and', reusedWhereClause, reusedWhereClause] })
  expect(result.success).toBe(true)
  expect(result.data).toBe('SELECT * FROM data WHERE "id" AND "id";')

  const selfReferentialWhereClause: SqlOperator<never> = ['and', reusedWhereClause, reusedWhereClause]
  selfReferentialWhereClause[1] = selfReferentialWhereClause
  result = generateSql('postgres', fields, { where: selfReferentialWhereClause })
  expect(result.success).toBe(false)
  expect(result.error?.message).toBe('Circular dependency detected')
})

test('allows custom types, formatting, and dialects', () => {
  type Extras =
    | ['<' | '>' | '=' | '!=', SqlValue<number | Date>, SqlValue<number | Date>]
    | ['like' | 'ilike', SqlValue<string>, SqlValue<string>]
  const postgresBase = builtInFormatters.postgres as unknown as SqlFormatter<Extras>
  const postgresWithExtras: SqlFormatter<Extras> = {
    ...postgresBase,
    formatOperator: (where, meta) => {
      const { formatValue } = meta.formatter
      switch (where[0]) {
        case 'ilike':
        case 'like':
          return `${formatValue(where[1], meta)} ${where[0].toUpperCase()} ${formatValue(where[2], meta)}`
      }
      return postgresBase.formatOperator(where, meta)
    },
    formatValue: (value, meta) => {
      if (value instanceof Date) {
        // NOTE: This is just meant to show that you COULD add dialect-specific date formatting;
        // this example wouldn't actually return dates in postgres's datetime format.
        return meta.formatter.formatValue(value.toISOString(), meta)
      }
      return postgresBase.formatValue(value, meta)
    },
  }
  const emojiSql: SqlFormatter<Extras> = {
    ...postgresBase,
    formatStatement: (sql, meta) => {
      const parts: string[] = ['☝️ ⭐']
      if (sql.from) parts.push(`➡️ ${sql.from}`)
      if (sql.where) {
        parts.push(`🔍 ${meta.formatter.formatOperator(sql.where, meta)}`)
      }
      if (sql.limit) parts.push(`🛑 ${sql.limit}`)
      return parts.join(' ')
    },
  }
  const { generateSql } = createSqlTranspiler<Extras>({
    formatters: {
      postgres: postgresWithExtras,
      emojiSql,
    },
  })
  const d = new Date()
  let result: Result<string, Error>
  result = generateSql('postgres', fields, {
    where: [
      'and',
      ['<', ['field', 3], d],
      ['ilike', ['field', 2], 'A%'],
    ],
  })
  expect(result.success).toBe(true)
  expect(result.data).toBe(
    `SELECT * FROM data WHERE "date_joined" < '${d.toISOString()}' AND "name" ILIKE 'A%';`,
  )

  result = generateSql('emojiSql', fields, { limit: 10 })
  expect(result.success).toBe(true)
  expect(result.data).toBe('☝️ ⭐ ➡️ data 🛑 10;')
})

import { describe, expect, test } from 'vitest'
import { createSqlTranspiler, type Result, type SqlWhereClause } from './generateSql'

const fields = {
  1: 'id',
  2: 'name',
  3: 'date_joined',
  4: 'age',
}

test('handles the cases from the prompt: https://gist.github.com/perivamsi/1cbea6e3874ba5638cd58202d7dcb1f7', () => {
  const { generateSql } = createSqlTranspiler({ tableName: 'data' })
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

describe('macros', () => {
  test('supports macros', () => {
    const { generateSql } = createSqlTranspiler({
      tableName: 'data',
      macros: { 'is_joe': ['=', ['field', 2], 'joe'] },
    })
    const result = generateSql('postgres', fields, { where: ['and', ['<', ['field', 1], 5], ['macro', 'is_joe']] })
    expect(result.success).toBe(true)
    expect(result.data).toBe('SELECT * FROM data WHERE "id" < 5 AND "name" = \'joe\';')
  })

  test('supports nested macros', () => {
    const { generateSql } = createSqlTranspiler({
      tableName: 'data',
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
    const { generateSql } = createSqlTranspiler({ tableName: 'data' })
    const result = generateSql('postgres', fields, { where: ['and', ['<', ['field', 1], 5], ['macro', 'is_adult_joe']] })
    expect(result.success).toBe(false)
    expect(result.error?.message).toBe('Macro not found: is_adult_joe')
  })
})

test('returns an error when the where clause contains a circular dependency', () => {
  const { generateSql } = createSqlTranspiler({
    tableName: 'data',
    macros: {
      'is_good': ['and', ['macro', 'is_decent'], ['>', ['field', 4], 18]],
      'is_decent': ['and', ['macro', 'is_good'], ['<', ['field', 5], 5]],
    },
  })
  let result: Result<string, Error>
  result = generateSql('postgres', fields, { where: ['macro', 'is_decent'] })
  expect(result.success).toBe(false)
  expect(result.error?.message).toBe('Circular dependency detected')

  const reusedWhereClause: SqlWhereClause = ['field', 1]
  result = generateSql('postgres', fields, { where: ['and', reusedWhereClause, reusedWhereClause] })
  expect(result.success).toBe(true)
  expect(result.data).toBe('SELECT * FROM data WHERE "id" AND "id";')

  const selfReferentialWhereClause: SqlWhereClause = ['and', reusedWhereClause, reusedWhereClause]
  selfReferentialWhereClause[1] = selfReferentialWhereClause
  result = generateSql('postgres', fields, { where: selfReferentialWhereClause })
  expect(result.success).toBe(false)
  expect(result.error?.message).toBe('Circular dependency detected')
})

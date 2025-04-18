
type SqlField = ['field', number]

export type SqlValue<T = number | string | null> = SqlField | T

type BaseOperator = [string, ...unknown[]]

export type SqlOperator<TExtra extends BaseOperator> =
  | SqlField
  | ['and' | 'or', SqlOperator<TExtra>, SqlOperator<TExtra>]
  | ['not', SqlOperator<TExtra>]
  | ['<' | '>', SqlValue<number>, SqlValue<number>]
  | ['=' | '!=', SqlValue, SqlValue, ...SqlValue[]]
  | ['is-empty' | 'not-empty', SqlValue]
  | ['macro', never]
  | TExtra

interface SqlQuery<TExtra extends BaseOperator> {
  limit?: number,
  where?: SqlOperator<TExtra>,
}

type SqlStatement<TExtra extends BaseOperator> = {
  type: 'SELECT',
  list: string,
  from?: string,
  where?: SqlOperator<TExtra>,
  limit?: number,
  // ...other clause types (e.g. "group by")
}/* | ...other statement types (e.g. "insert") */

export interface SqlFormatter<TExtra extends BaseOperator> {
  formatStatement: (sql: SqlStatement<TExtra>, meta: SqlFormatterMetadata<TExtra>) => string,
  formatColumn: (columnName: string) => string,
  formatValue: (value: SqlValue, meta: SqlFormatterMetadata<TExtra>) => string,
  formatOperator: (where: SqlOperator<TExtra>, meta: SqlFormatterMetadata<TExtra>) => string,
}

interface SqlFormatterMetadata<TExtra extends BaseOperator> {
  formatter: SqlFormatter<TExtra>,
  fields: Record<number, string>,
  macros: Record<string, SqlOperator<TExtra>>,
  visited: SqlOperator<TExtra>[],
}

const defaultFormatOperator = (where: SqlOperator<never>, meta: SqlFormatterMetadata<never>): string => {
  if (meta.visited.includes(where)) {
    throw new Error('Circular dependency detected')
  }
  meta = { ...meta, visited: [...meta.visited, where] }

  const { formatValue, formatOperator } = meta.formatter
  switch (where[0]) {
    case 'and':
    case 'or': {
      const [, ...clauses] = where
      const parts = clauses.map(c => {
        const clauseStr = formatOperator(c, meta)
        const needsWrapped = ['and', 'or'].includes(c[0])
        return !needsWrapped ? clauseStr : `(${clauseStr})`
      })
      return parts.join(` ${where[0].toUpperCase()} `)
    }

    case 'not':
      return `NOT (${formatOperator(where[1], meta)})`

    case '<':
    case '>': {
      const [sign, a, b] = where
      return `${formatValue(a, meta)} ${sign} ${formatValue(b, meta)}`
    }

    case '=':
    case '!=': {
      const [sign, ...operands] = where
      const [a, ...rest] = operands
      let signSql: string
      if (rest.length === 1) {
        const b = rest[0]
        if (b === null) {
          signSql = sign === '!=' ? 'IS NOT' : 'IS'
        } else {
          signSql = sign === '!=' ? '<>' : '='
        }
        return `${formatValue(a, meta)} ${signSql} ${formatValue(b, meta)}`
      }
      signSql = sign === '!=' ? 'NOT IN' : 'IN'
      return `${formatValue(a, meta)} ${signSql} (${rest.map(f => formatValue(f, meta)).join(', ')})`
    }

    case 'is-empty': return `${formatValue(where[1], meta)} IS NULL`
    case 'not-empty': return `${formatValue(where[1], meta)} IS NOT NULL`

    case 'field': return formatValue(where, meta)

    case 'macro': {
      const macro = meta.macros[where[1]]
      if (!macro) {
        throw new Error(`Macro not found: ${where[1]}`)
      }
      return formatOperator(macro, meta)
    }
  }
}

const defaultFormatter: SqlFormatter<never> = {
  formatStatement: (sql, meta) => {
    const parts: string[] = [sql.type, sql.list]
    if (sql.from) parts.push(`FROM ${sql.from}`)
    if (sql.where) {
      parts.push(`WHERE ${meta.formatter.formatOperator(sql.where, meta)}`)
    }
    if (sql.limit) parts.push(`LIMIT ${sql.limit}`)
    return parts.join(' ')
  },
  formatColumn: name => `"${name}"`,
  formatValue: (value, { fields, formatter }) => {
    if (Array.isArray(value)) {
      const [, key] = value
      const columnName = fields[key]
      if (!columnName) {
        throw new Error(`Unknown field number: ${key}`)
      }
      return formatter.formatColumn(columnName)
    }
    if (typeof value === 'string') {
      return `'${value}'`
    }
    if (typeof value === 'number') {
      return `${value}`
    }
    return 'NULL'
  },
  formatOperator: defaultFormatOperator,
}

export const builtInFormatters = {
  sqlserver: {
    ...defaultFormatter,
    formatStatement: (sql, meta) => {
      const parts: string[] = [sql.type]
      if (sql.limit) parts.push(`TOP ${sql.limit}`)
      parts.push(sql.list)
      if (sql.from) parts.push(`FROM ${sql.from}`)
      if (sql.where) {
        parts.push(`WHERE ${meta.formatter.formatOperator(sql.where, meta)}`)
      }
      return parts.join(' ')
    },
  },
  postgres: {
    ...defaultFormatter,
  },
  mysql: {
    ...defaultFormatter,
    formatColumn: name => `\`${name}\``,
  },
} satisfies Record<string, SqlFormatter<never>>

export type Result<T, E> =
  | { success: true, error?: undefined, data: T }
  | { success: false, error: E, data?: undefined }

interface SqlTranspilerOptions<TExtra extends BaseOperator> {
  tableName?: string,
  macros?: Record<string, SqlOperator<TExtra>>,
  formatters?: Record<string, SqlFormatter<TExtra>>,
}

export const createSqlTranspiler = <TExtra extends BaseOperator = never>(options: SqlTranspilerOptions<TExtra>) => {
  const { tableName, macros = {} } = options
  const formatters = (options.formatters || builtInFormatters) as Record<string, SqlFormatter<TExtra>>

  return {
    generateSql: (dialect: string, fields: Record<number, string>, query: SqlQuery<TExtra>): Result<string, Error> => {
      const formatter = formatters[dialect]
      if (!formatter) {
        return { success: false, error: new Error(`No formatter found for dialect: ${dialect}`) }
      }
      try {
        const sqlStr = formatter.formatStatement({
          type: 'SELECT',
          list: '*',
          from: tableName,
          where: query.where,
          limit: query.limit,
        }, { formatter, fields, macros, visited: [] })
        return { success: true, data: `${sqlStr};` }
      } catch (e) {
        return { success: false, error: (e instanceof Error) ? e : new Error('Unknown error') }
      }
    },
  }
}

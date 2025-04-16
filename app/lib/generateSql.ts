
type SqlField = ['field', number]

type SqlValue<T = number | string | null> = SqlField | T

type SqlWhereClause =
  | SqlField
  | ['and' | 'or', SqlWhereClause, SqlWhereClause]
  | ['not', SqlWhereClause]
  | ['<' | '>', SqlValue<number>, SqlValue<number>]
  | ['=' | '!=', SqlValue, SqlValue, ...SqlValue[]]
  | ['is-empty' | 'not-empty', SqlValue]

interface SqlQuery {
  limit?: number,
  where?: SqlWhereClause,
}

type SqlStatement = {
  verb: 'SELECT',
  list: string,
  from?: string,
  where?: SqlWhereClause,
  limit?: number,
  // ...other clause types (e.g. "group by")
}/* | ...other statement types (e.g. "insert") */

interface SqlFormatter {
  formatStatement: (sql: SqlStatement, options: SqlFormatterOptions) => string,
  formatColumn: (columnName: string) => string,
  formatValue: (value: SqlValue, options: SqlFormatterOptions) => string,
}

interface SqlFormatterOptions {
  formatter: SqlFormatter,
  fields: Record<number, string>,
}

// TODO: Wrap nested conditions in parentheses
const formatWhereClause = (where: SqlWhereClause, options: SqlFormatterOptions): string => {
  const { formatValue } = options.formatter
  switch (where[0]) {
    // TODO: Clean up 'and' and 'or'
    case 'and': {
      const [, a, b] = where
      return `${formatWhereClause(a, options)} AND ${formatWhereClause(b, options)}`
    }
    case 'or': {
      const [, a, b] = where
      return `${formatWhereClause(a, options)} OR ${formatWhereClause(b, options)}`
    }
    // TODO: Implement
    case 'not': return `${formatWhereClause(where[1], options)}`
    case '<':
    case '>': {
      const [sign, a, b] = where
      return `${formatValue(a, options)} ${sign} ${formatValue(b, options)}`
    }
    case '=':
    case '!=': {
      const [operator, ...operands] = where
      const [a, ...rest] = operands
      if (rest.length === 1) {
        const b = rest[0]
        const sign = operator === '!=' ? '<>' : '='
        return `${formatValue(a, options)} ${sign} ${formatValue(b, options)}`
      }
      // TODO: Handle null value
      const sign = operator === '!=' ? 'NOT IN' : 'IN'
      return `${formatValue(a, options)} ${sign} (${rest.map(f => formatValue(f, options)).join(', ')})`
    }
    case 'is-empty': return `${formatValue(where[1], options)} IS NULL`
    case 'not-empty': return `${formatValue(where[1], options)} IS NOT NULL`
    case 'field': return formatValue(where[1], options)
  }
}

const defaultFormatter: SqlFormatter = {
  formatStatement: (sql, options) => {
    const parts: string[] = [sql.verb, sql.list]
    if (sql.from) parts.push(`FROM ${sql.from}`)
    if (sql.where) {
      parts.push(`WHERE ${formatWhereClause(sql.where, options)}`)
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
      return `"${value}"`
    }
    if (typeof value === 'number') {
      return `${value}`
    }
    return 'NULL'
  },
}

const builtInFormatters: Record<string, SqlFormatter> = {
  sqlserver: {
    ...defaultFormatter,
    formatStatement: (sql, options) => {
      const parts: string[] = [sql.verb]
      if (sql.limit) parts.push(`TOP ${sql.limit}`)
      parts.push(sql.list)
      if (sql.from) parts.push(`FROM ${sql.from}`)
      if (sql.where) {
        parts.push(`WHERE ${formatWhereClause(sql.where, options)}`)
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
}

type Result<T, E> = { success: true, data: T } | { success: false, error: E }

interface SqlTranspilerOptions {
  tableName?: string,
  macros?: unknown,
  formatters?: Record<string, SqlFormatter>,
}

export const createSqlTranspiler = ({ tableName, /*macros,*/ formatters = builtInFormatters }: SqlTranspilerOptions) => {

  const generateSql = (
    dialect: string,
    fields: Record<number, string>,
    query: SqlQuery,
  ): Result<string, Error> => {
    const formatter = formatters[dialect]
    if (!formatter) {
      return { success: false, error: new Error(`No formatter found for dialect: ${dialect}`) }
    }
    try {
      const data = formatter.formatStatement({
        verb: 'SELECT',
        list: '*',
        from: tableName,
        where: query.where,
        limit: query.limit,
      }, { formatter, fields })
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e instanceof Error) ? e : new Error('Unknown error') }
    }
  }

  return {
    generateSql,
  }
}

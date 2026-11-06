let listIds: number[] = []
let listPath = '/unread'

export function rememberList(ids: number[], path: string) {
  listIds = ids
  listPath = path
}

export function neighbours(id: number): { prev: number | null; next: number | null; back: string } {
  const index = listIds.indexOf(id)
  return {
    prev: index > 0 ? listIds[index - 1] : null,
    next: index >= 0 && index < listIds.length - 1 ? listIds[index + 1] : null,
    back: listPath,
  }
}

import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { isTypingTarget, useAsync, useHotkeys } from '../../lib/hooks'
import { bumpRevision } from '../../lib/store'

describe('useAsync', () => {
  it('loads data, reloads on key, revision and reload()', async () => {
    let calls = 0
    const loader = vi.fn(async () => ++calls)
    const { result, rerender } = renderHook(({ key }) => useAsync(loader, key), { initialProps: { key: 'a' } })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toBe(1))
    expect(result.current.loading).toBe(false)
    rerender({ key: 'b' })
    await waitFor(() => expect(result.current.data).toBe(2))
    act(() => bumpRevision())
    await waitFor(() => expect(result.current.data).toBe(3))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.data).toBe(4))
  })

  it('reports errors as messages', async () => {
    const { result } = renderHook(() => useAsync(async () => Promise.reject(new Error('nope'))))
    await waitFor(() => expect(result.current.error).toBe('nope'))
    const { result: plain } = renderHook(() => useAsync(async () => Promise.reject('raw')))
    await waitFor(() => expect(plain.current.error).toBe('raw'))
  })

  it('ignores results after unmount', async () => {
    let resolve: (value: number) => void = () => undefined
    let reject: (reason: unknown) => void = () => undefined
    const { result, unmount } = renderHook(() => useAsync(() => new Promise<number>((res) => (resolve = res))))
    unmount()
    await act(async () => resolve(5))
    expect(result.current.data).toBeUndefined()
    const failing = renderHook(() => useAsync(() => new Promise<number>((_res, rej) => (reject = rej))))
    failing.unmount()
    await act(async () => reject(new Error('late')))
    expect(failing.result.current.error).toBe('')
  })
})

describe('useHotkeys', () => {
  it('runs the latest handler and ignores typing and modifiers', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(({ handler }) => useHotkeys({ j: handler }), { initialProps: { handler: first } })
    fireEvent.keyDown(window, { key: 'j' })
    rerender({ handler: second })
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'x' })
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'j' })
    input.remove()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    unmount()
    fireEvent.keyDown(window, { key: 'j' })
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('detects typing targets', () => {
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isTypingTarget(editable)).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

import React, { useReducer, useContext, useMemo } from 'react'
import hoistStatics from 'hoist-non-react-statics'
import propTypes from 'prop-types'

/**
 * 创建一个小型的store
 * @param {object} reducerObject
 * @param {object} initState
 */
export default options => {
  const {
    initState = {},
    mutations = {},
    actions: rawActions = {},
    getters: rawGetters = {},
  } = options || {}

  mixinState(initState)
  mixinMutations(mutations)

  const reducer = (state, action) => {
    const { type, payload } = action
    const mutation = mutations[type]
    // 用于开发环境时提示拼写错误，可以不计入测试覆盖率
    /* istanbul ignore else */
    if (typeof mutation === 'function') {
      return mutation(state, payload)
    } else {
      typeError(type)
    }
  }
  const Context = React.createContext(null)

  const Provider = props => {
    const { children } = props
    const [state, dispatch] = useReducer(reducer, initState)
    // 计算一把computed
    const getters = useMemo(() => initGetter(rawGetters, state), [state])
    // 让actions执行前后改变loading
    const actions = useMemo(() => initActions(rawActions, dispatch), [])
    const dispatchAction = useMemo(
      () => initDispatchAction(dispatch, actions, state, getters),
      [actions, getters, state]
    )
    // dispatchAction没法做到引用保持不变 所以挂到dispatch上
    // 这样用户使用useEffect把dispatch作为依赖 就不会造成无限更新
    dispatch.action = dispatchAction
    // 给loadingMap加上一些api
    enhanceLoadingMap(state.loadingMap)

    return (
      <Context.Provider
        value={{
          state,
          dispatch,
          getters,
        }}
      >
        {children}
      </Context.Provider>
    )
  }

  Provider.propTypes = {
    children: propTypes.element.isRequired,
  }

  const connect = Component => {
    const WrapWithProvider = props => (
      <Provider>
        <Component {...props} />
      </Provider>
    )

    // 加上displayName
    // 拷贝静态属性
    return argumentContainer(WrapWithProvider, Component)
  }

  const useStore = () => useContext(Context)

  return { connect, useStore }
}

// 加入loadingMap
// 通过action的key可以读取到action是否正在执行
function mixinState(state) {
  const loadingMap = Object.create(null)
  Object.assign(state, { loadingMap })
}

const CHANGE_LOADING = '@@changeLoadingState'

// 加入改变loading状态的方法
function mixinMutations(mutations) {
  return Object.assign(mutations, {
    [CHANGE_LOADING](state, payload) {
      const { actionKey, isLoading } = payload
      const { loadingMap } = state
      const newLoadingMap = {
        ...loadingMap,
        [actionKey]: isLoading,
      }
      return {
        ...state,
        loadingMap: newLoadingMap,
      }
    },
  })
}

// 通过最新的state把getter计算出来
function initGetter(rawGetters, state) {
  const getters = {}
  const rawGetterKeys = Object.keys(rawGetters)
  rawGetterKeys.forEach(rawGetterKey => {
    const rawGetter = rawGetters[rawGetterKey]
    const result = rawGetter(state)
    getters[rawGetterKey] = result
  })
  return getters
}

// 劫持原有的action方法 在action执行前后更改loading状态
function initActions(rawActions, dispatch) {
  const changeLoading = (actionKey, isLoading) =>
    dispatch({
      type: CHANGE_LOADING,
      payload: {
        isLoading,
        actionKey,
      },
    })
  const actions = {}
  const rawActionKeys = Object.keys(rawActions)
  rawActionKeys.forEach(rawActionKey => {
    actions[rawActionKey] = async (...actionArgs) => {
      changeLoading(rawActionKey, true)
      const result = await rawActions[rawActionKey](...actionArgs)
      changeLoading(rawActionKey, false)
      return result
    }
  })

  return actions
}

// dispatch actions里的方法
// 返回promise
function initDispatchAction(dispatch, actions, state, getters) {
  return ({ type, payload }) => {
    return new Promise((resolve, reject) => {
      if (typeof actions[type] === 'function') {
        actions[type]({ dispatch, state, getters }, payload).then(resolve)
      } else {
        typeError(type)
      }
    })
  }
}

function enhanceLoadingMap(loadingMap) {
  Object.assign(loadingMap, {
    any: keys => {
      keys = Array.isArray(keys) ? keys : [keys]
      return keys.some(key => !!loadingMap[key])
    },
  })
}

function typeError(type) {
  throw new Error(`error action type:${type}`)
}

function getDisplayName(WrappedComponent) {
  return (
    WrappedComponent.displayName || WrappedComponent.name || 'WrappedComponent'
  )
}

function argumentContainer(Container, WrappedComponent) {
  // 给组件增加displayName
  Container.displayName = `Store(${getDisplayName(WrappedComponent)})`
  // 增加被包裹组件的引用
  Container.WrappedComponent = WrappedComponent
  return hoistStatics(Container, WrappedComponent)
}
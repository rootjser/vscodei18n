// args => https://egodigital.github.io/vscode-powertools/api/interfaces/_contracts_.buttonactionscriptarguments.html
// s. https://code.visualstudio.com/api/references/vscode-api

const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const recast = require('recast')
const jecast = require('json-to-ast')
const lodash = require('lodash')

// 外部参数
let ArgsOptions = {}

const AstWorker = {
  helpFullFile(filepath) {
    if (/\.(json|js)$/.test(filepath)) {
      return filepath
    }
    const jsState = fs.existsSync(filepath + '.js')
    if (jsState) return filepath + '.js'
    const jsonState = fs.existsSync(filepath + '.json')
    if (jsonState) return filepath + '.json'
    const jsIndexState = fs.existsSync(filepath + '/index.js')
    if (jsIndexState) return filepath + '/index.js'
    const jsonIndexState = fs.existsSync(filepath + '/index.json')
    if (jsonIndexState) return filepath + '/index.json'
  },
  parseJsVariable(variableMap, property, filepath) {
    const { key, value } = property
    // 字符串
    if (value.type == 'Literal') {
      return {
        [key.name]: {
          value: value.value,
          filepath,
          loc: {
            start: value.loc.start,
            end: value.loc.end
          },
          __leefnode: true
        }
      }
    }
    // 对象
    else if (value.type == 'ObjectExpression') {
      return {
        [key.name]: value.properties.reduce((preItem, item) => {
          return {
            ...preItem,
            ...AstWorker.parseJsVariable(variableMap, item, filepath)
          }
        }, {})
      }
    }
    // 变量
    else if (value.type == 'Identifier') {
      // return {
      //     [key.name]: variableMap[key.name]
      // }
      return variableMap[key.name]
    }
    // webpack系统变量
    else if (value.type == 'MemberExpression') {
      return {
        [key.name]: {
          value: value.property?.name,
          filepath,
          loc: {
            start: value.loc.start,
            end: value.loc.end
          },
          __leefnode: true
        }
      }
    }
  },
  parseJsonVariable(property, filepath) {
    const { key, value } = property
    // 字符串
    if (value.type == 'Literal') {
      return {
        [key.value]: {
          value: value.value,
          filepath,
          loc: {
            start: value.loc.start,
            end: value.loc.end
          },
          __leefnode: true
        }
      }
    }
    // 对象
    else if (value.type == 'Object') {
      return {
        [key.value]: value.children.reduce((preItem, item) => {
          return {
            ...preItem,
            ...AstWorker.parseJsonVariable(item, filepath)
          }
        }, {})
      }
    }
  },
  parseAst(filepath, message) {
    if (/\.json$/.test(filepath)) {
      return AstWorker.parse2Json(filepath, message)
    } else if (/\.js$/.test(filepath)) {
      return AstWorker.parse2Js(filepath, message)
    }
  },
  parse2Json(filepath, message) {
    const conent = fs.readFileSync(filepath, 'utf-8')
    const astTree = jecast(conent)
    return astTree.children
      .filter(property => {
        const { key } = property
        return message ? key.value == message : true // 优化计算速度，只要message的对象
      })
      .reduce((preItem, item) => {
        return {
          ...preItem,
          ...AstWorker.parseJsonVariable(item, filepath)
        }
      }, {})
  },
  parse2Js(filepath, message) {
    const conent = fs.readFileSync(filepath, 'utf-8')
    const ast = recast.parse(conent)
    const { body } = ast.program
    /**
     * 处理 import
     */
    const bodyImportDeclarationMap = body
      .filter(item => item.type == 'ImportDeclaration')
      .filter(item => {
        if (!message) return true
        // 减少计算量 只取以message开头的变量
        return message.startsWith(item.specifiers[0].local.name)
      })
      .reduce((preItem, item) => {
        const { value } = item.source
        const name = item.specifiers[0].local.name
        return {
          ...preItem,
          [name]: AstWorker.parseAst(
            AstWorker.helpFullFile(path.join(filepath, '/../', value)),
            message?.substr(name.length + 1)
          )
        }
      }, {})
    /**
     * 处理变量
     */
    const bodyVariableDeclarationMap = lodash
      .flattenDeep(
        body
          .filter(item => item.type == 'VariableDeclaration')
          .map(item => item.declarations)
      )
      .reduce((preItem, item) => {
        return {
          ...preItem,
          [item.id.name]: {
            ...item.init.properties.reduce((preProperty, property) => {
              const innerMap = AstWorker.parseJsVariable(
                bodyImportDeclarationMap,
                property,
                filepath
              )
              // es6 简写
              if (property.value.type == 'Identifier') {
                return {
                  ...preProperty,
                  [property.key.name]: {
                    ...innerMap
                  }
                }
              }
              // json对象
              else {
                return {
                  ...preProperty,
                  ...innerMap
                }
              }
            }, {})
          }
        }
      }, {})

    /**
     * 处理导出Default
     */
    const defaultExportDeclaration = body.find(
      item => item.type == 'ExportDefaultDeclaration'
    ).declaration
    const combileMap = {
      ...bodyImportDeclarationMap,
      ...bodyVariableDeclarationMap
    }

    let bodyExportDefaultDeclarationMap = null
    if (defaultExportDeclaration.type == 'Identifier') {
      bodyExportDefaultDeclarationMap = {
        [defaultExportDeclaration.name]:
          combileMap[defaultExportDeclaration.name]
      }
    } else {
      bodyExportDefaultDeclarationMap = defaultExportDeclaration.properties.reduce(
        (preItem, item) => {
          return {
            ...preItem,
            ...AstWorker.parseJsVariable(combileMap, item, filepath)
          }
        },
        {}
      )
    }
    return bodyExportDefaultDeclarationMap
  },
  flattenJson(sourceTree, locale, outsiteKey) {
    const copyTree = {}
    const travese = (tree, parentKey) => {
      for (const key in tree) {
        const newKey = parentKey ? parentKey + '.' + key : key
        if (tree[key]) {
          if (tree[key].__leefnode) {
            copyTree[newKey] = tree[key]
            copyTree[newKey].locale = locale
          } else {
            travese(tree[key], newKey)
          }
        }
      }
    }
    travese(sourceTree, outsiteKey)
    return copyTree
  },
  requestCN(message) {
    return ArgsOptions.cnRoot.reduce((preTree, root) => {
      const sourceTree = AstWorker.parseAst(
        AstWorker.helpFullFile(path.join(__dirname, '../', root)),
        !/\.json$/.test(root) ? message : null
      )
      const rootKeys = Object.keys(sourceTree)
      const currentTree =
        rootKeys.length > 1
          ? AstWorker.flattenJson(sourceTree, '中')
          : AstWorker.flattenJson(sourceTree[rootKeys[0]], '中')
      return {
        ...preTree,
        ...currentTree
      }
    }, {})
  },
  requestEN(message) {
    return ArgsOptions.enRoot.reduce((preTree, root) => {
      const sourceTree = AstWorker.parseAst(
        AstWorker.helpFullFile(path.join(__dirname, '../', root)),
        !/\.json$/.test(root) ? message : null
      )
      const rootKeys = Object.keys(sourceTree)
      const currentTree =
        rootKeys.length > 1
          ? AstWorker.flattenJson(sourceTree, 'EN')
          : AstWorker.flattenJson(sourceTree[rootKeys[0]], 'EN')
      return {
        ...preTree,
        ...currentTree
      }
    }, {})
  }
}

const Commands = {
  open_key: 'open_key'
}

const DashUI = {
  showMessage: vscode.window.showInformationMessage,
  getMessage(document, position) {
    const { character } = position
    const { text } = document.lineAt(position.line)
    let start = character - 1,
      end = character
    for (; start >= 0; start--) {
      if (/['"`]/.test(text[start])) break
    }
    for (; end < text.length; end++) {
      if (/['"`]/.test(text[end])) break
    }
    return text.substring(start + 1, end)
  },
  queryNodes(document, position) {
    const message = DashUI.getMessage(document, position)
    if (!message) return []
    let i18nCN = {},
      i18nEN = {}
    try {
      i18nCN = AstWorker.requestCN(message)
    } catch (e) {
      DashUI.showMessage('中文json国际化配置错误')
    }
    try {
      i18nEN = AstWorker.requestEN(message)
    } catch (e) {
      // DashUI.showMessage('English intel config file error')
    }
    return [i18nCN[message], i18nEN[message]]
  },
  createHover(document, position) {
    const curNodes = DashUI.queryNodes(document, position)
    const isExistEntity = curNodes.find(ae => ae)
    if (!isExistEntity) return undefined
    const markdown = DashUI.createTable(curNodes)
    const markdownText = new vscode.MarkdownString(`${markdown}`, true)
    markdownText.isTrusted = true
    return markdownText
  },
  createTable(records) {
    const transTable = records
      .filter(ae => ae)
      .map(record => {
        const command = record ? DashUI.getAvaliableCommands(record) : ''
        return `| | **${record.locale}** | | ${record?.value} | ${command} |`
      })
      .join('\n')
    return `| | | | | |\n|---|---:|---|---|---:|\n${transTable}\n| | | | | |`
  },
  getAvaliableCommands(record) {
    return [
      {
        text: 'Go',
        icon: '✏️',
        command: DashUI.makeMarkdownCommand(Commands.open_key, { ...record })
      }
    ]
      .map(c =>
        typeof c === 'string' ? c : `[${c.icon}](${c.command} "${c.text}")`
      )
      .join(' ')
  },
  makeMarkdownCommand(command, args) {
    return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
  }
}

exports.execute = async args => {
  ArgsOptions = args.options

  /**
   * this.$t('memberManage.member.tab.transHistory')
   */
  vscode.languages.registerHoverProvider('*', {
    provideHover(document, position) {
      const markdownText = DashUI.createHover(document, position)
      return new vscode.Hover(markdownText)
    }
  })

  /**
   * curNode 格式
   * {"value":"早上好","filepath":"d:\\XXXXXX\\XXXX.js","loc":{"start":{"line":86,"column":21,"token":331},"end":{"line":86,"column":31,"token":332}},"__leefnode":true,"locale":"EN"}
   */
  vscode.commands.registerCommand(Commands.open_key, async curNode => {
    const thisDocment = await vscode.workspace.openTextDocument(
      vscode.Uri.file(curNode.filepath)
    )
    const {
      loc: { start, end }
    } = curNode
    vscode.window.showTextDocument(thisDocment, {
      selection: new vscode.Range(
        start.line - 1,
        0, // 用start.column不方便
        end.line - 1,
        end.column
      )
    })
  })
}

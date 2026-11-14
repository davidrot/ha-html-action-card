export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'lit'; v: boolean | null }
  /** Unquoted word without a dot, e.g. `on`, `open`: a string. */
  | { t: 'word'; v: string }
  /** `domain.object.<path>` into the state object: `.state`, `.attributes.brightness`, ... */
  | { t: 'ref'; entity: string; path: string[] }
  | { t: 'call'; name: string; args: Expr[] }
  | { t: 'unary'; op: '!' | '-' | '+'; arg: Expr }
  | { t: 'bin'; op: BinOp; l: Expr; r: Expr }
  | { t: 'cond'; test: Expr; a: Expr; b: Expr };

export type BinOp =
  | '||' | '&&'
  | '==' | '!='
  | '<' | '>' | '<=' | '>='
  | '+' | '-' | '*' | '/' | '%';

export class ExprSyntaxError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(`${message} (at position ${pos})`);
    this.name = 'ExprSyntaxError';
  }
}

export class ExprRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprRuntimeError';
  }
}

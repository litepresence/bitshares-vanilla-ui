# Reference UI palette (resolved)

Extracted from `bitshares-ui/app/assets/stylesheets/themes/` by
`tooling/extract_palette.py` — every `$variable` resolved through
references + `darken()`/`lighten()` to its final value, per theme.
Use these exact values when pixel-matching slices (principle #2).

| variable | dark | light | midnight |
|---|---|---|---|
| light-text-color | #fff | #3d3d3d | #fff |
| dark-text-color | #444 | #5c5c5c | #444 |
| primary-text-color | #e0e0e0 | #242424 | #e0e0e0 |
| secondary-text-color | #adadad | #5c5c5c | #adadad |
| inactive-text-color | #939393 | #646464 | #7a7a7a |
| link-text-color | #1ec3fa | #337ab7 | #049cce |
| error-text-color | #ff3950 | #e3745b | #e3745b |
| settings-select-bg | #3f3f3f | #e5e6e4 | #1e1f25 |
| settings-select-color | #adadad | #656565 | #737373 |
| settings-api-node-border-color | #2a2a2a | #e6e6e6 | #2a2b34 |
| main-content-margin-block-bg-color | #1e1e1e | #f8f9f8 | #151619 |
| bg-color | #2a2a2a | #fff | #191a1f |
| panel-bg-color | #3f3f3f | #e5e6e4 | #2c2e37 |
| light-panel-bg-color | #6a6a6a | #fff | #353742 |
| super-light-panel-bg-color | #7e7e7e | #fcfcfc | #474a59 |
| settings-menu-hover-bg | #373737 | #e6e6e6 | #2a2b34 |
| settings-menu-active-bg | #373737 | #e6e6e6 | #2a2b34 |
| button-bg-color | #049cce | #2196f3 | #049cce |
| secondary-button-bg-color | #999999 | #999999 | #546979 |
| input-background | #2d2d2d | #ebebeb | #1b1c22 |
| alert-color | #ff3950 | #e3745b | #e3745b |
| info-color | #a0d3e8 | #ce7925 | #4a90e2 |
| success-color | #7bd500 | #21d19f | #18bc9c |
| warning-color | #fcab53 | #f35b92 | #fcab53 |
| fee-color | #adadad | #7f055e | #adadad |
| bid-color | #6ba583 | #258a14 | #50d2c2 |
| ask-color | #e3745b | #ea340b | #e3745b |
| call-color | #bbbf2b | #bbbf2b | #bbbf2b |
| positive-color | #258a14 | #528c0a | #6ec105 |
| negative-color | #ff3950 | rgba(225, 66, 74, 1) | #e1424a |
| row-accent-color | #3c3c3c | #ffffff | #3c3c3c |
| header-color | #484848 | #dcdcdc | #484848 |
| account-header | #656565 | #eaeaea | #1a242f |
| account-cells | #4b5158 | #dadada | #27384b |
| account-green | #7ed321 | #488a00 | #7ed321 |
| account-primarytext | white | #242424 | white |
| account-dimmed | #afafaf | #5d5d5d | #606060 |
| account-border | #323131 | rgba(50, 49, 49, 0.1) | #323131 |
| account-background | #3f3f3f | #e5e6e4 | black |
| account-tabs-background | #2f2f2f | #d5d6d4 | inherit |
| pulsate-green-start | #7ed321 | #488a00 | #7ed321 |
| pulsate-green-end | #aaf25c | #70c117 | #b4f271 |
| pulsate-red-start | #ff3950 | rgba(225, 66, 74, 1) | #e1424a |
| pulsate-red-end | #ef4040 | #e87f84 | #ef7c82 |
| modal-bg-color | #4b5158 | #dadada | #27384b |
| mobile-input-bg | #2d2d2d | #ebebeb | #1b1c22 |
| slider-thumb-color | #f00 | — | — |
| incognito-bg | #ff3950 | #ea340b | #e3745b |
| tab-content-background-color | #6f6f6f | #f4f4f4 | #212e3c |
| explorer-tab-content-background-color | #2a2a2a | #fff | #212e3c |
| explorer--witnesses--info-bg | transparent | transparent | #27384b |
| explorer--witnesses--info-border | #565656 | #dbdbdb | #484848 |
| explorer--witnesses--info-table-title-color | #afafaf | #8f8f8f | #808080 |
| explorer--witnesses--info-table-text-color | #fff | #5c5c5c | #fff |
| explorer--assets--bg | #2a2a2a | #fff | #191a1f |
| positive-color-alternative | #22d173 | #22d173 | #22d173 |
| negative-color-alternative | #ff276d | #ff276d | #ff276d |
| medium-color | #ff9900 | #ff9900 | #ff9900 |
| dark-help-text | #171a25 | #171a25 | #171a25 |
| separator-line | rgba(23, 26, 37, 0.3) | rgba(23, 26, 37, 0.3) | rgba(23, 26, 37, 0.3) |
| settings-label-color | rgba(255, 255, 255, 0.5) | rgba(0, 0, 0, 0.65) | rgba(255, 255, 255, 0.5) |
| primary-color | #337ab7 | #337ab7 | #337ab7 |
| primary-dark | #2a2a2a | — | #191a1f |
| white | #fff | #fff | #fff |
| dark | rgba(0, 0, 0, 0.6) | rgba(0, 0, 0, 0.6) | rgba(0, 0, 0, 0.6) |
| dark-1 | rgba(76, 76, 76, 0.6) | rgba(76, 76, 76, 0.6) | rgba(76, 76, 76, 0.6) |
| dark-2 | rgba(153, 153, 153, 0.6) | rgba(153, 153, 153, 0.6) | rgba(153, 153, 153, 0.6) |
| dark-3 | rgba(230, 230, 230, 0.6) | rgba(230, 230, 230, 0.6) | rgba(230, 230, 230, 0.6) |
| header-background-color | rgba(0, 0, 0, 0.6) | #fff | #30323b |
| header-shadow | 0 !important | 0 4px 9px 0 #00000015 !important | 0 2px 9px 0 #30323b !important |
| header-item--color | #fff | rgba(51, 51, 51, 0.6) | #e6e6e6 |
| header-item-background-color | rgba(0, 0, 0, 0.6) | #fff | #30323b |
| header-item--active--background-color | #2a2a2a | #fff | #30323b |
| header-item--active--color | #fff | #337ab7 | #049cce |
| tabs-border-size | 1px | 1px | 1px |
| tabs-border-color | #373737 | rgba(230, 230, 230, 0.6) | #24262d |
| tabs-background-color | #2a2a2a | #fff | #191a1f |
| tabs-item-background-color | #2a2a2a | #fff | #191a1f |
| tabs-item-color | #fff | rgba(0, 0, 0, 0.6) | #fff |
| tabs-item-border-size | 3px | 3px | 3px |
| tabs-item-border-color | #2a2a2a | #fff | #191a1f |
| tabs-item--active--color | rgba(0, 0, 0, 0.6) | rgba(0, 0, 0, 0.6) | rgba(0, 0, 0, 0.6) |
| tabs-item--active--border-color | #337ab7 | #337ab7 | #337ab7 |
| tabs-item--active--background-color | #2a2a2a | #fff | #191a1f |
| tabs-content-background-color | #2a2a2a | #fff | #191a1f |
| selector-active-border-color | #337ab7 | #337ab7 | #337ab7 |
| selector-active-text-color | #337ab7 | #337ab7 | #337ab7 |
| selector-border-color | #373737 | rgba(230, 230, 230, 0.6) | #24262d |
| selector-text-color | #838383 | rgba(76, 76, 76, 0.6) | #696d82 |
| header-menu--active--icon-background | #2a2a2a | #fff | #191a1f |
| header-menu--active--box-shadow | 0 4px 9px 0 #00000015 | 0 4px 9px 0 #00000015 | 0 4px 9px 0 #00000015 |
| header-menu-background-color | #373737 | #fff | #24262d |
| header-menu-item--hover--background-color | #444444 | #c7ddef | #30323b |

## Font stacks (by frequency across reference stylesheets)

- (3x) `$body-font-family`
- (3x) `$paragraph-font-family`
- (2x) `inherit`
- (2x) `Consolas, 'Liberation Mono', Courier, monospace`
- (2x) `"Roboto-Regular", arial, sans-serif`
- (1x) `Roboto, sans-serif`
- (1x) `"Roboto-Regular", arial, sans-serif !important`
- (1x) `Roboto Medium, Monospaced Number, Chinese Quote, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Helvetica, Arial, sans-serif`
- (1x) `Roboto-Regular, Helvetica, Arial, sans-serif`
- (1x) `"Helvetica Neue", "Helvetica", Helvetica, Arial, sans-serif !default`
- (1x) `"Helvetica Neue", "Helvetica", Helvetica, Arial, sans-serif`
- (1x) `$body-font-family !default`
- (1x) `inherit !default`
- (1x) `Consolas, "Liberation Mono", Courier, monospace !default`
- (1x) `$paragraph-font-family !default`
- (1x) `$header-font-family`
- (1x) `$code-font-family`
- (1x) `$list-font-family`
- (1x) `"#{$foundation-version`
- (1x) `"#{map-serialize($breakpoints)`
- (1x) `sans-serif`
- (1x) `monospace, monospace`
- (1x) `$font-family`
- (1x) `"Roboto-Light", arial, sans-serif`
- (1x) `"Roboto-Medium", arial, sans-serif`
- (1x) `"RobotoCondensed-Regular", arial, sans-serif`
- (1x) `"wf_SegoeUILight", "Segoe UI Light", "Segoe WP Light", "wf_SegoeUI", "Segoe UI", "Segoe", "Segoe WP", "Tahoma", "Verdana", arial, sans-serif`
- (1x) `"wf_SegoeUI", "Segoe UI", "Segoe", "Segoe WP", "Tahoma", "Verdana", arial, sans-serif`
- (1x) `"Lucida Console", Monaco, monospace !important`


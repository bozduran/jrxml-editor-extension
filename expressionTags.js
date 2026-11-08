// expressionTags.js
// The single source of truth for JRXML elements whose content is an expression.
//
// Every consumer derives from this list: the Expression Editor and If/Else
// hand-off (expressionUtils), completion and expression-tag detection
// (completionProvider), expression lint (diagnosticsProvider), reference
// collection (xmlClear) and the used-name scan (jrxmlParser). The TextMate
// grammar carries the same list in its own begin/end regexes; test/
// expressionUtils.test.js asserts the two never drift apart, so a tag added
// here must also be added to syntaxes/jrxml.tmLanguage.json.

const EXPRESSION_TAGS = [
    'textFieldExpression', 'imageExpression', 'variableExpression',
    'groupExpression', 'printWhenExpression', 'initialValueExpression',
    'filterExpression', 'expression', 'jr:expression',
    'defaultValueExpression', 'anchorNameExpression',
    'bookmarkLevelExpression', 'hyperlinkReferenceExpression',
    'hyperlinkAnchorExpression', 'hyperlinkPageExpression',
    'hyperlinkTooltipExpression', 'labelExpression', 'connectionExpression',
    'subreportExpression', 'bucketExpression', 'sortFieldExpression',
    'keyExpression', 'valueExpression', 'seriesExpression',
    'categoryExpression', 'lowExpression', 'highExpression',
    'openExpression', 'closeExpression', 'volumeExpression',
    'xValueExpression', 'yValueExpression', 'zValueExpression',
    'timePeriodExpression', 'startDateExpression', 'endDateExpression',
    'colorExpression', 'sizeExpression', 'shapeExpression',
    'datasetExpression', 'customExpression', 'crosstabExpression',
    'chartTitleExpression', 'chartSubtitleExpression',
];

module.exports = { EXPRESSION_TAGS };

# -*- coding: utf-8 -*-
{
    'name': 'Multi Search Column Filter',
    'version': '17.0.1.0.0',
    'category': 'Extra Tools',
    'summary': 'Add search boxes to list view columns',
    'depends': ['web'],
    'data': [],
    'assets': {
        'web.assets_backend': [
            'multi_search_column_filter/static/src/css/column_search.css',
            'multi_search_column_filter/static/src/js/list_controller.js',
            'multi_search_column_filter/static/src/xml/list_view.xml',
        ],
    },
    'author': 'RedRuby Technologies',
    'website': 'https://redrubytechnologies.com/',
    'images': ['static/description/banner.png'],
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}


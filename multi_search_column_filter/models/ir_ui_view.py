# -*- coding: utf-8 -*-
from odoo import models, api

class IrUiView(models.Model):
    _inherit = 'ir.ui.view'

    @api.model
    def get_field_info(self, model_name, field_name):
        try:
            model = self.env[model_name]
            if field_name in model._fields:
                field = model._fields[field_name]
                return {
                    'type': field.type,
                    'string': field.string,
                    'searchable': True,
                }
        except:
            pass
        return {'searchable': False}

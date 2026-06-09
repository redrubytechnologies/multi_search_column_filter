/** @odoo-module **/

import { ListController } from "@web/views/list/list_controller";
import { patch } from "@web/core/utils/patch";
import { onMounted, onWillUnmount, onPatched } from "@odoo/owl";

patch(ListController.prototype, {
    setup() {
        super.setup();

        if (!this.props.resModel) {
            return;
        }

        this.columnFilters = {};
        this.columnInfoMap = {};
        this._searchTimeout = null;
        this._isSearchRowInjected = false;

        console.log("✅ Multi Search Column Filter initialized for:", this.props.resModel);
        console.log("📋 Available fields:", Object.keys(this.props.fields || {}));

        // Build column metadata map
        if (this.props.archInfo?.columns && this.props.fields) {
            this.props.archInfo.columns.forEach((col, index) => {
                if (col.type !== "field") return;

                const fieldDef = this.props.fields[col.name];
                if (!fieldDef) {
                    return;
                }

                const fieldType = fieldDef.type;
                let domainField = col.name;

                // Handle relational fields
                if (fieldType === "many2one") {
                    domainField = `${col.name}.name`;
                } else if (fieldType === "many2many" || fieldType === "one2many") {
                    domainField = `${col.name}.name`;
                }

                // Handle related fields
                if (col.related) {
                    domainField = col.related;
                    if (fieldType === "many2one" && !domainField.endsWith(".name")) {
                        domainField = `${domainField}.name`;
                    }
                }

                this.columnInfoMap[col.name] = {
                    type: fieldType,
                    domainField: domainField,
                    index: index,
                };
                
                console.log(`📌 Mapped column: ${col.name} → ${domainField} (${fieldType})`);
            });
        }

        onMounted(() => {
            this.injectSearchRow();
            this.attachColumnSearchListeners();
        });

        onPatched(() => {
            this.injectSearchRow();
            this.attachColumnSearchListeners();
        });

        onWillUnmount(() => {
            if (this._searchTimeout) {
                clearTimeout(this._searchTimeout);
            }
        });
    },

    injectSearchRow() {
        const listView = document.querySelector(".o_list_view");
        if (!listView) return;

        const thead = listView.querySelector("thead");
        if (!thead) return;

        // Check if search row already exists
        let searchRow = thead.querySelector(".column_search_row");
        if (searchRow) {
            // Update existing row
            this.updateSearchRow(searchRow);
            return;
        }

        // Get the header row
        const headerRow = thead.querySelector("tr");
        if (!headerRow) return;

        // Create search row
        searchRow = document.createElement("tr");
        searchRow.className = "column_search_row";

        // Clone header structure
        const headerCells = headerRow.querySelectorAll("th");
        headerCells.forEach((headerCell, index) => {
            const searchCell = document.createElement("th");
            
            // Copy classes for alignment
            searchCell.className = headerCell.className;

            // Check if this is a checkbox/selector column
            if (headerCell.classList.contains("o_list_record_selector") || 
                headerCell.querySelector("input[type='checkbox']")) {
                searchRow.appendChild(searchCell);
                return;
            }

            // Check if this is a favorites/star column
            if (headerCell.classList.contains("o_list_record_remove") ||
                headerCell.querySelector(".fa-star") ||
                headerCell.querySelector(".o_favorite")) {
                searchRow.appendChild(searchCell);
                return;
            }

            // Check if this is the actions column (usually last)
            if (index === headerCells.length - 1 && 
                (headerCell.classList.contains("o_list_controller") || 
                 headerCell.querySelector(".o_optional_columns_dropdown") ||
                 headerCell.querySelector(".dropdown"))) {
                searchRow.appendChild(searchCell);
                return;
            }

            // Check if this is an empty column (common at the end)
            const cellContent = headerCell.textContent.trim();
            const hasChildren = headerCell.children.length > 0;
            if (!cellContent && !hasChildren) {
                searchRow.appendChild(searchCell);
                return;
            }

            // Find field name from header cell
            const fieldName = this.getFieldNameFromHeader(headerCell);
            
            if (fieldName && this.isSearchableField(fieldName, headerCell)) {
                // Create search input
                const wrapper = document.createElement("div");
                wrapper.className = "column_search_wrapper";

                const input = document.createElement("input");
                input.type = "text";
                input.className = "column_search_input";
                input.setAttribute("data-field", fieldName);
                input.setAttribute("data-index", index);
                input.placeholder = "Search...";
                input.autocomplete = "off";

                // Restore previous filter value
                if (this.columnFilters[fieldName]) {
                    input.value = this.columnFilters[fieldName];
                    input.classList.add("has-value");
                }

                const clearBtn = document.createElement("button");
                clearBtn.type = "button";
                clearBtn.className = "column_search_clear";
                clearBtn.setAttribute("data-field", fieldName);
                clearBtn.title = "Clear";
                clearBtn.textContent = "×";

                wrapper.appendChild(input);
                wrapper.appendChild(clearBtn);
                searchCell.appendChild(wrapper);
            }

            searchRow.appendChild(searchCell);
        });

        // Insert after header row
        headerRow.parentNode.insertBefore(searchRow, headerRow.nextSibling);
        this._isSearchRowInjected = true;

        console.log("✅ Search row injected with", searchRow.querySelectorAll(".column_search_input").length, "inputs");
    },

    updateSearchRow(searchRow) {
        // Restore filter values to existing inputs
        const inputs = searchRow.querySelectorAll(".column_search_input");
        inputs.forEach(input => {
            const fieldName = input.dataset.field;
            if (this.columnFilters[fieldName] && input.value !== this.columnFilters[fieldName]) {
                input.value = this.columnFilters[fieldName];
                input.classList.add("has-value");
            } else if (!this.columnFilters[fieldName] && input.value) {
                input.value = "";
                input.classList.remove("has-value");
            }
        });
    },

    getFieldNameFromHeader(headerCell) {
        // Try to get field name from various sources
        const fieldSpan = headerCell.querySelector("[data-name]");
        if (fieldSpan) {
            return fieldSpan.getAttribute("data-name");
        }

        const nameAttr = headerCell.getAttribute("data-name");
        if (nameAttr) {
            return nameAttr;
        }

        // Try to match by column position with archInfo
        const allHeaders = Array.from(headerCell.parentNode.children);
        const columnIndex = allHeaders.indexOf(headerCell);
        
        if (this.props.archInfo?.columns) {
            // Account for checkbox column
            const hasCheckbox = allHeaders[0]?.classList.contains("o_list_record_selector");
            const adjustedIndex = hasCheckbox ? columnIndex - 1 : columnIndex;
            
            const column = this.props.archInfo.columns[adjustedIndex];
            if (column && column.type === "field") {
                return column.name;
            }
        }

        return null;
    },

    isSearchableField(fieldName, headerCell) {
        // If no field name found, not searchable
        if (!fieldName) {
            return false;
        }

        // Check if field is in our column info map
        if (!this.columnInfoMap[fieldName]) {
            return false;
        }

        // Exclude special widgets
        const excludedWidgets = ["handle", "boolean_favorite", "boolean_button"];
        const excludedFields = ["activity_ids", "message_ids"];

        if (excludedFields.includes(fieldName)) {
            return false;
        }

        // Check if this is a favorites/star column
        if (headerCell.classList.contains("o_list_record_remove") ||
            headerCell.querySelector(".fa-star") ||
            headerCell.querySelector(".o_favorite") ||
            headerCell.querySelector("[data-widget='boolean_favorite']")) {
            return false;
        }

        // Check if header cell is essentially empty (no meaningful content)
        const hasText = headerCell.textContent.trim().length > 0;
        const hasIcon = headerCell.querySelector("i, .fa, .oi");
        const hasWidget = headerCell.querySelector("[data-widget]");
        
        if (!hasText && !hasIcon && !hasWidget) {
            return false;
        }

        // Check for excluded widgets in header
        for (const widget of excludedWidgets) {
            if (headerCell.querySelector(`[data-widget="${widget}"]`)) {
                return false;
            }
        }

        return true;
    },

    attachColumnSearchListeners() {
        const listView = document.querySelector(".o_list_view");
        if (!listView) return;

        const inputs = listView.querySelectorAll(".column_search_input");
        
        inputs.forEach((input) => {
            // Skip if already has listener (check by looking for our custom property)
            if (input._hasColumnSearchListener) {
                return;
            }

            input._hasColumnSearchListener = true;

            // Input event
            input.addEventListener("input", (ev) => {
                const field = ev.target.dataset.field;
                const value = ev.target.value.trim();

                if (value) {
                    ev.target.classList.add("has-value");
                    this.columnFilters[field] = value;
                } else {
                    ev.target.classList.remove("has-value");
                    delete this.columnFilters[field];
                }

                if (this._searchTimeout) {
                    clearTimeout(this._searchTimeout);
                }

                this._searchTimeout = setTimeout(() => {
                    this.applyColumnFilters();
                }, 300);
            });

            // Keydown event
            input.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    if (this._searchTimeout) {
                        clearTimeout(this._searchTimeout);
                    }
                    this.applyColumnFilters();
                } else if (ev.key === "Escape") {
                    ev.target.value = "";
                    ev.target.classList.remove("has-value");
                    delete this.columnFilters[ev.target.dataset.field];
                    this.applyColumnFilters();
                }
            });
        });

        // Attach clear button listeners
        const clearButtons = listView.querySelectorAll(".column_search_clear");
        clearButtons.forEach((button) => {
            if (button._hasColumnSearchListener) {
                return;
            }

            button._hasColumnSearchListener = true;

            button.addEventListener("click", (ev) => {
                const field = ev.currentTarget.dataset.field;
                const wrapper = ev.currentTarget.closest(".column_search_wrapper");
                const input = wrapper?.querySelector(".column_search_input");

                if (input) {
                    input.value = "";
                    input.classList.remove("has-value");
                    delete this.columnFilters[field];
                    this.applyColumnFilters();
                    input.focus();
                }
            });
        });

        if (inputs.length > 0) {
            console.log("✅ Listeners attached to", inputs.length, "inputs");
        }
    },

    applyColumnFilters() {
        if (!this.model?.root) {
            console.error("Model root not available");
            return;
        }

        const baseDomain = this.props.domain || [];
        const domain = JSON.parse(JSON.stringify(baseDomain));

        console.log("🔍 Applying filters:", this.columnFilters);

        for (const [columnName, value] of Object.entries(this.columnFilters)) {
            const column = this.columnInfoMap[columnName];
            if (!column) {
                console.warn("⚠️ Column info not found for:", columnName);
                console.warn("Available columns:", Object.keys(this.columnInfoMap));
                continue;
            }

            const fieldPath = column.domainField;
            const fieldType = column.type;
            const searchValue = value.trim();

            if (!searchValue) continue;

            console.log(`🔎 Processing search: column="${columnName}", field="${fieldPath}", type="${fieldType}", value="${searchValue}"`);

            let condition;

            switch (fieldType) {
                case "many2one":
                case "many2many":
                case "one2many":
                    condition = [fieldPath, "ilike", searchValue];
                    break;

                case "char":
                case "text":
                    condition = [fieldPath, "ilike", searchValue];
                    break;

                case "selection":
                    // For selection fields, we need to match against possible values
                    // Get the field definition to access selection options
                    const fieldDef = this.props.fields[columnName];
                    
                    if (fieldDef && fieldDef.selection) {
                        const matchedValues = [];
                        
                        // Search through selection options
                        for (const [value, label] of fieldDef.selection) {
                            // Match against both technical value and display label (case-insensitive)
                            if (value.toString().toLowerCase().includes(searchValue.toLowerCase()) ||
                                label.toLowerCase().includes(searchValue.toLowerCase())) {
                                matchedValues.push(value);
                            }
                        }
                        
                        if (matchedValues.length > 0) {
                            // Create OR conditions for all matched values
                            if (matchedValues.length === 1) {
                                condition = [fieldPath, "=", matchedValues[0]];
                            } else {
                                // Build OR domain: ['|', ['field', '=', val1], '|', ['field', '=', val2], ['field', '=', val3]]
                                const orOperators = Array(matchedValues.length - 1).fill('|');
                                const valueConditions = matchedValues.map(val => [fieldPath, "=", val]);
                                condition = [...orOperators, ...valueConditions];
                            }
                        }
                    } else {
                        // Fallback to ilike if selection not available
                        condition = [fieldPath, "ilike", searchValue];
                    }
                    break;

                case "integer":
                case "float":
                case "monetary":
                    // For numeric fields, create multiple OR conditions to match prefix
                    const cleanNum = searchValue.replace(/[₹$€£,\s]/g, '');
                    
                    if (cleanNum && !isNaN(parseFloat(cleanNum))) {
                        const baseNum = parseFloat(cleanNum);
                        const orConditions = [];
                        
                        // Create ranges for different magnitudes
                        // "66" should match: 66, 660-669, 6600-6699, 66000-66999, etc.
                        
                        // Exact match for the base number
                        orConditions.push([fieldPath, '=', baseNum]);
                        
                        // Range matches for larger numbers (multiply by 10, 100, 1000, etc.)
                        for (let power = 1; power <= 6; power++) {
                            const multiplier = Math.pow(10, power);
                            const minVal = Math.floor(baseNum * multiplier);
                            const maxVal = Math.floor((baseNum + 1) * multiplier) - 1;
                            
                            orConditions.push('&');
                            orConditions.push([fieldPath, '>=', minVal]);
                            orConditions.push([fieldPath, '<=', maxVal]);
                        }
                        
                        // Build proper OR domain: ['|', cond1, '|', cond2, cond3]
                        // For N conditions, we need N-1 '|' operators at the start
                        if (orConditions.length > 1) {
                            const numConditions = 1 + 6; // 1 exact + 6 ranges
                            const orOperators = Array(numConditions - 1).fill('|');
                            condition = [...orOperators, ...orConditions];
                        } else {
                            condition = orConditions[0];
                        }
                    }
                    break;

                case "date":
                case "datetime":
                    // Parse DD/MM/YYYY format (display format) to ISO YYYY-MM-DD (database format)
                    const dateMatch = searchValue.match(/^(\d{1,2})(\/(\d{1,2})?(\/(\d{2,4})?)?)?$/);
                    
                    if (dateMatch) {
                        const day = dateMatch[1];
                        const month = dateMatch[3];
                        const year = dateMatch[5];
                        
                        if (year) {
                            // Full date: DD/MM/YYYY -> YYYY-MM-DD
                            const fullYear = year.length === 2 ? '20' + year : year;
                            const isoDate = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                            condition = [fieldPath, '=', isoDate];
                        } else if (month) {
                            // Partial: DD/MM -> match any year with this month and day
                            const paddedDay = day.padStart(2, '0');
                            const paddedMonth = month.padStart(2, '0');
                            condition = [fieldPath, 'ilike', `%-${paddedMonth}-${paddedDay}`];
                        } else {
                            // Day only: DD -> match any date ending with this day
                            const paddedDay = day.padStart(2, '0');
                            condition = [fieldPath, 'ilike', `%-${paddedDay}`];
                        }
                    } else {
                        // Fallback: try text search
                        condition = [fieldPath, 'ilike', searchValue];
                    }
                    break;

                case "boolean":
                    const isTrue = ["true", "1", "yes", "y", "t"].includes(searchValue.toLowerCase());
                    const isFalse = ["false", "0", "no", "n", "f"].includes(searchValue.toLowerCase());
                    if (isTrue) {
                        condition = [fieldPath, "=", true];
                    } else if (isFalse) {
                        condition = [fieldPath, "=", false];
                    }
                    break;

                default:
                    condition = [fieldPath, "ilike", searchValue];
            }

            if (condition) {
                // For complex OR/AND conditions, we need to add them differently
                if (Array.isArray(condition) && (condition[0] === '|' || condition[0] === '&')) {
                    // This is a complex domain, add all elements
                    condition.forEach(elem => domain.push(elem));
                } else {
                    // Simple condition
                    domain.push(condition);
                }
                console.log("➕ Added condition:", condition);
            }
        }

        console.log("🎯 Final domain:", domain);

        try {
            this.model.root.load({ domain, offset: 0 });
            console.log("✅ Filter applied successfully");
        } catch (error) {
            console.error("❌ Column search error:", error);
        }
    }
});